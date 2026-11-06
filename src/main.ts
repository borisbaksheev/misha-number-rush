import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import './ui/styles.css';
import { App, type ModeId } from './app';
import { Game } from './game/game';
import { SkyGame } from './sky/skyGame';

const $ = (id: string) => document.getElementById(id)!;

// Block page scrolling, pinch zoom and long-press menus during play (iPad Safari).
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

$('version').textContent = `v${__APP_VERSION__}`;

/** Friendly full-screen message with a reload button instead of a silent broken screen. */
function showProblem(title: string, text: string): void {
  $('problemTitle').textContent = title;
  $('problemText').textContent = text;
  $('problem').classList.remove('hidden');
}
$('reloadBtn').addEventListener('pointerup', () => location.reload());

let app: App;
try {
  app = new App($('game'));
  app.register('race', (host) => new Game(host));
  app.register('sky', (host) => new SkyGame(host));
  app.run();
} catch (err) {
  startupFailed(err);
  throw err;
}
function startupFailed(err: unknown): void {
  console.error(err);
  showProblem(
    'Oops!',
    'The 3D game could not start on this device. Close the app completely and open it again. ' +
      `(${err instanceof Error ? err.message : String(err)})`,
  );
}
const w = window as unknown as { __app: App; __game: Game; __sky: () => SkyGame };
w.__app = app;
w.__game = app.mode('race') as unknown as Game;
w.__sky = () => app.mode('sky') as unknown as SkyGame;
// Warm up the racing track (the menu backdrop) behind the loading cover, then show the menu.
app.enter('race', false).catch(startupFailed);

// iPad Safari can drop the WebGL context when memory runs low; offer a clean restart.
app.renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  app.active?.pause();
  showProblem('Taking a little rest', 'The picture needs a quick refresh. Tap the button to keep playing.');
});

function syncToggles(): void {
  for (const id of ['sfxToggle', 'sfxToggle2']) $(id).dataset.on = String(app.sound.sfxOn);
  for (const id of ['musicToggle', 'musicToggle2']) $(id).dataset.on = String(app.sound.musicOn);
}
syncToggles();

const tap = (id: string, fn: () => void) =>
  $(id).addEventListener('pointerup', (e) => {
    e.stopPropagation();
    fn();
  });

let busy = false;
/** Start a mode: warm-up happens behind the loading cover so play starts sharp and smooth. */
function play(id: ModeId): void {
  if (busy) return;
  busy = true;
  app.sound.unlock(); // must happen inside the tap for iPad Safari
  app
    .enter(id, true, () => $('start').classList.add('hidden'))
    .catch(startupFailed)
    .finally(() => (busy = false));
}

function toMenu(): void {
  if (reloadPending) return location.reload();
  if (busy) return;
  busy = true;
  app
    .enter('race', false, () => {
      $('pause').classList.add('hidden');
      app.hud.show(false);
      $('start').classList.remove('hidden');
    })
    .catch(startupFailed)
    .finally(() => (busy = false));
}

tap('raceBtn', () => play('race'));
tap('skyBtn', () => play('sky'));
tap('pauseBtn', () => {
  app.sound.click();
  app.active?.pause();
  $('pause').classList.remove('hidden');
  if (reloadPending) location.reload();
});
tap('resumeBtn', () => {
  app.sound.click();
  $('pause').classList.add('hidden');
  app.active.resume();
});
tap('restartBtn', () => {
  app.sound.click();
  $('pause').classList.add('hidden');
  app.active.restart();
});
tap('menuBtn', () => {
  app.sound.click();
  toMenu();
});
for (const id of ['sfxToggle', 'sfxToggle2']) {
  tap(id, () => {
    app.sound.unlock();
    app.sound.setSfx(!app.sound.sfxOn);
    syncToggles();
    app.sound.click();
  });
}
for (const id of ['musicToggle', 'musicToggle2']) {
  tap(id, () => {
    app.sound.unlock();
    app.sound.setMusic(!app.sound.musicOn);
    syncToggles();
  });
}
// stop UI presses from also driving the character
for (const id of ['pauseBtn', 'start', 'pause', 'problem']) $(id).addEventListener('pointerdown', (e) => e.stopPropagation());

// Pause automatically when the app is hidden (?nopause turns this off for automated testing).
const autoPause = !new URLSearchParams(location.search).has('nopause');
document.addEventListener('visibilitychange', () => {
  if (autoPause && document.hidden && app.active?.mode === 'playing') {
    app.active?.pause();
    $('pause').classList.remove('hidden');
  }
});

// Offline support and automatic updates (service worker generated at build time).
// iPadOS often *resumes* a Home Screen app instead of reloading it, which skips the browser's
// own update check, so also check whenever the app comes back to the foreground and every minute.
let reloadPending = false;
function reloadWhenSafe(): void {
  if (app.active?.mode === 'playing') reloadPending = true; // don't interrupt a game in progress
  else location.reload();
}
async function checkForUpdate(reg: ServiceWorkerRegistration | undefined): Promise<void> {
  if (document.hidden) return;
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = (await res.json()) as { version?: string };
    if (!version || version === __APP_VERSION__) return;
    $('version').textContent = `v${__APP_VERSION__} → updating to v${version}…`;
    if (reg) await reg.update();
    else reloadWhenSafe();
  } catch {
    // offline: keep playing the saved version
  }
}
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register')
    .then(({ registerSW }) =>
      registerSW({
        immediate: true,
        onNeedReload: reloadWhenSafe,
        onRegisteredSW(_url, reg) {
          const check = () => void checkForUpdate(reg);
          document.addEventListener('visibilitychange', check);
          window.addEventListener('focus', check);
          setInterval(check, 60_000);
          check();
        },
      }),
    )
    .catch(() => undefined);
}
