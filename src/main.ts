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
  app.activate('race'); // the racing track is the menu backdrop
  app.run();
} catch (err) {
  console.error(err);
  $('loading').textContent = '';
  showProblem(
    'Oops!',
    'The 3D game could not start on this device. Close the app completely and open it again. ' +
      `(${err instanceof Error ? err.message : String(err)})`,
  );
  throw err;
}
const w = window as unknown as { __app: App; __game: Game; __sky: () => SkyGame };
w.__app = app;
w.__game = app.mode('race') as Game;
w.__sky = () => app.mode('sky') as SkyGame;
$('loading').classList.add('hidden');

// iPad Safari can drop the WebGL context when memory runs low; offer a clean restart.
app.renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  app.active.pause();
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

function play(id: ModeId): void {
  app.sound.unlock();
  if (id === 'sky' && !app.hasMode('sky')) {
    // the first visit builds the sky; let "Getting the sky ready…" paint first
    $('loading').textContent = 'Getting the sky ready…';
    $('loading').classList.remove('hidden');
    requestAnimationFrame(() =>
      setTimeout(() => {
        $('loading').classList.add('hidden');
        $('start').classList.add('hidden');
        app.activate(id).start();
      }, 30),
    );
    return;
  }
  $('start').classList.add('hidden');
  app.activate(id).start();
}

function toMenu(): void {
  $('pause').classList.add('hidden');
  app.hud.show(false);
  app.activate('race').toTitle();
  $('start').classList.remove('hidden');
}

tap('raceBtn', () => play('race'));
tap('skyBtn', () => play('sky'));
tap('pauseBtn', () => {
  app.sound.click();
  app.active.pause();
  $('pause').classList.remove('hidden');
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
  if (autoPause && document.hidden && app.active.mode === 'playing') {
    app.active.pause();
    $('pause').classList.remove('hidden');
  }
});

// Offline support (service worker generated at build time).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => undefined);
}
