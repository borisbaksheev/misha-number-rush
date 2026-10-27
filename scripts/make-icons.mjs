// Builds the app icon (SVG + PNG sizes) from the bundled Fredoka glyph outlines.
// Usage: npm run icons
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, 'public/icons');
const buf = fs.readFileSync(path.join(root, 'node_modules/@fontsource/fredoka/files/fredoka-latin-700-normal.woff'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

function glyphPath(ch, size, cx, baseline) {
  const g = font.charToGlyph(ch);
  const scale = size / font.unitsPerEm;
  const w = (g.xMax - g.xMin) * scale;
  const x = cx - w / 2 - g.xMin * scale;
  return g.getPath(x, baseline, size).toPathData(2);
}

/** `inset` shrinks the artwork for maskable icons (safe zone). */
function svg(inset = 1, rounded = true) {
  const s = 512;
  const c = s / 2;
  const k = inset;
  const two = glyphPath('2', 330 * k, c, c + 150 * k);
  const plus = glyphPath('+', 120 * k, c + 150 * k, c - 100 * k);
  const eye = (x) => `
    <ellipse cx="${x}" cy="${c - 92 * k}" rx="${30 * k}" ry="${35 * k}" fill="#fff" stroke="#2c1840" stroke-width="${6 * k}"/>
    <ellipse cx="${x + 5 * k}" cy="${c - 87 * k}" rx="${15 * k}" ry="${18 * k}" fill="#1d1030"/>
    <circle cx="${x + 11 * k}" cy="${c - 95 * k}" r="${5 * k}" fill="#fff"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a9cf5"/>
      <stop offset="0.65" stop-color="#9fd6ff"/>
      <stop offset="1" stop-color="#ffd3ea"/>
    </linearGradient>
    <linearGradient id="digit" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffa45c"/>
      <stop offset="1" stop-color="#ff6a00"/>
    </linearGradient>
  </defs>
  <rect width="${s}" height="${s}" rx="${rounded ? 112 : 0}" fill="url(#bg)"/>
  <path d="M0 ${s * 0.78} Q ${s * 0.5} ${s * 0.62} ${s} ${s * 0.78} L ${s} ${s} L 0 ${s} Z" fill="#5850d8"/>
  <path d="M${s * 0.47} ${s * 0.7} L ${s * 0.53} ${s * 0.7} L ${s * 0.56} ${s} L ${s * 0.44} ${s} Z" fill="#fff" opacity="0.8"/>
  <g transform="translate(0 ${8 * k})"><path d="${two}" fill="#2c1840" opacity="0.25"/></g>
  <path d="${two}" fill="url(#digit)" stroke="#2c1840" stroke-width="${10 * k}" stroke-linejoin="round" paint-order="stroke"/>
  ${eye(c - 38 * k)}${eye(c + 38 * k)}
  <path d="M ${c - 20 * k} ${c - 46 * k} Q ${c} ${c - 30 * k} ${c + 20 * k} ${c - 46 * k}" stroke="#4a1a3a" stroke-width="${8 * k}" fill="none" stroke-linecap="round"/>
  <path d="${plus}" fill="#2fd98a" stroke="#2c1840" stroke-width="${7 * k}" paint-order="stroke"/>
</svg>`;
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.svg'), svg());
const render = (markup, size, file) => {
  const png = new Resvg(markup, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(path.join(outDir, file), png);
  console.log(`wrote ${file} (${(png.length / 1024).toFixed(0)} KB)`);
};
render(svg(), 192, 'icon-192.png');
render(svg(), 512, 'icon-512.png');
render(svg(0.78, false), 512, 'icon-512-maskable.png');
render(svg(1, false), 180, 'apple-touch-icon.png');
