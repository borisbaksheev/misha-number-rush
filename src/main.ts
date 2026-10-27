import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import './ui/styles.css';
import { Game } from './game/game';

const $ = (id: string) => document.getElementById(id)!;

// Block page scrolling, pinch zoom and long-press menus during play (iPad Safari).
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

const game = new Game($('game'));
(window as unknown as { __game: Game }).__game = game;
$('loading').classList.add('hidden');

function syncToggles(): void {
  for (const id of ['sfxToggle', 'sfxToggle2']) $(id).dataset.on = String(game.sound.sfxOn);
  for (const id of ['musicToggle', 'musicToggle2']) $(id).dataset.on = String(game.sound.musicOn);
}
syncToggles();

const tap = (id: string, fn: () => void) =>
  $(id).addEventListener('pointerup', (e) => {
    e.stopPropagation();
    fn();
  });

tap('playBtn', () => {
  $('start').classList.add('hidden');
  game.start();
});
tap('pauseBtn', () => {
  game.sound.click();
  game.pause();
  $('pause').classList.remove('hidden');
});
tap('resumeBtn', () => {
  game.sound.click();
  $('pause').classList.add('hidden');
  game.resume();
});
tap('restartBtn', () => {
  game.sound.click();
  $('pause').classList.add('hidden');
  game.restart();
});
for (const id of ['sfxToggle', 'sfxToggle2']) {
  tap(id, () => {
    game.sound.unlock();
    game.sound.setSfx(!game.sound.sfxOn);
    syncToggles();
    game.sound.click();
  });
}
for (const id of ['musicToggle', 'musicToggle2']) {
  tap(id, () => {
    game.sound.unlock();
    game.sound.setMusic(!game.sound.musicOn);
    syncToggles();
  });
}
// stop UI presses from also driving the character
for (const id of ['pauseBtn', 'start', 'pause']) $(id).addEventListener('pointerdown', (e) => e.stopPropagation());

// Pause automatically when the app is hidden.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.mode === 'playing') {
    game.pause();
    $('pause').classList.remove('hidden');
  }
});

// Offline support (service worker generated at build time).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => undefined);
}
