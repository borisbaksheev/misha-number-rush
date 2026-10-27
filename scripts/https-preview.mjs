// Serves the production build over trusted HTTPS on the local Wi-Fi, so an iPad can
// install the game as an offline PWA (Safari only registers service workers on a
// trusted HTTPS origin).
//
// The first run creates a small local certificate authority in .cert/ (git-ignored;
// the private key never leaves this computer). Install .cert/misha-local-ca.crt on
// the iPad once and enable full trust for it - see "Installing on an iPad" in the
// README. The CA is name-constrained: it can only vouch for *.local names, localhost
// and private network addresses, never for real websites.
//
// Every run issues a fresh server certificate for this computer's current .local
// name and LAN addresses, then serves dist/ on port 4173. Usage: npm run ipad
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { preview } from 'vite';

const root = new URL('..', import.meta.url).pathname;
const certDir = join(root, '.cert');
const caKey = join(certDir, 'misha-local-ca.key');
const caCert = join(certDir, 'misha-local-ca.crt');
const serverKey = join(certDir, 'server.key');
const serverCert = join(certDir, 'server.crt');
const PORT = 4173;
const CA_DAYS = 1095;
// Apple rejects TLS server certificates valid for more than 825 days; stay well below.
const SERVER_DAYS = 397;

const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
const serial = () => {
  const bytes = randomBytes(16);
  bytes[0] &= 0x7f; // keep the serial positive
  return `0x${bytes.toString('hex')}`;
};

function localHostName() {
  if (process.platform === 'darwin') {
    try {
      return execFileSync('scutil', ['--get', 'LocalHostName']).toString().trim();
    } catch {
      // fall through to the generic hostname
    }
  }
  return hostname().replace(/\.local$/i, '');
}

const isPrivateIPv4 = (ip) =>
  /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && isPrivateIPv4(a.address))
    .map((a) => a.address);
}

function ensureCa() {
  if (existsSync(caKey) && existsSync(caCert)) return false;
  const config = join(certDir, 'ca.cnf');
  writeFileSync(
    config,
    `[req]
distinguished_name = dn
[dn]
[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical, permitted;DNS:local, permitted;DNS:localhost, permitted;IP:10.0.0.0/255.0.0.0, permitted;IP:172.16.0.0/255.240.0.0, permitted;IP:192.168.0.0/255.255.0.0, permitted;IP:127.0.0.0/255.0.0.0
`,
  );
  openssl('genrsa', '-out', caKey, '2048');
  chmodSync(caKey, 0o600);
  openssl(
    'req', '-x509', '-new', '-sha256', '-key', caKey, '-out', caCert,
    '-days', String(CA_DAYS), '-set_serial', serial(),
    '-subj', `/O=Misha's Number Rush (local)/CN=Number Rush local CA (${localHostName()})`,
    '-config', config, '-extensions', 'v3_ca',
  );
  return true;
}

function issueServerCert(names, ips) {
  const csr = join(certDir, 'server.csr');
  const config = join(certDir, 'server.cnf');
  const altNames = [...names.map((n) => `DNS:${n}`), ...ips.map((ip) => `IP:${ip}`)].join(', ');
  writeFileSync(
    config,
    `[server]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = ${altNames}
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
`,
  );
  openssl(
    'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
    '-keyout', serverKey, '-out', csr, '-subj', `/CN=${names[0]}`,
  );
  chmodSync(serverKey, 0o600);
  openssl(
    'x509', '-req', '-sha256', '-in', csr, '-CA', caCert, '-CAkey', caKey,
    '-set_serial', serial(), '-days', String(SERVER_DAYS), '-out', serverCert,
    '-extfile', config, '-extensions', 'server',
  );
}

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('dist/ is missing - run "npm run build" first (or use "npm run ipad").');
  process.exit(1);
}

mkdirSync(certDir, { recursive: true, mode: 0o700 });
const createdCa = ensureCa();
const host = `${localHostName()}.local`.toLowerCase();
const ips = lanAddresses();
issueServerCert([host, 'localhost'], [...ips, '127.0.0.1']);

const server = await preview({
  root,
  logLevel: 'warn',
  preview: {
    host: true,
    port: PORT,
    strictPort: true,
    https: { key: readFileSync(serverKey), cert: readFileSync(serverCert) },
  },
});

console.log(`
${createdCa ? 'Created a new local certificate authority.' : 'Using the existing local certificate authority.'}
  CA certificate for the iPad: ${caCert}
  (AirDrop it to the iPad once, install it and enable full trust - see README.)

Misha's Number Rush is served over HTTPS. Open this address in Safari on the iPad:

  https://${host}:${PORT}/
${ips.map((ip) => `  https://${ip}:${PORT}/   (IP address - may change, prefer the .local name)`).join('\n')}

Press Ctrl+C to stop.`);

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
