# Misha's Number Rush

An original 3D arcade racing game for young children where you **are a living number**.
Hold a finger to run, slide to steer, and run through glowing maths gates that physically
transform your character: numbers merge, duplicate, split into companions, join back together
and grow all the way to one million and beyond.

Built with Three.js + TypeScript + Vite as an installable, fully offline PWA. No backend,
accounts, ads, purchases or network services.

## Play

| Action | Touch (iPad) | Keyboard (desktop testing) |
| --- | --- | --- |
| Run | Hold a finger anywhere | ↑ / W / Space |
| Steer | Slide the finger left/right | ← → / A D |
| Slow down | Lift the finger | release |
| Pause / restart / sound | ❚❚ button (top right) | |

There is no game over: falling off the road puffs you back onto it, wrong turns are fine,
and gates that cannot be used (for example 7 ÷ 2) just fall asleep and let you through.

## What's in the first track

One 1.36 km sky loop (about 60–70 s per lap; you can keep driving lap after lap):

1. Start as **2**. A friendly **2** runs up and merges: **2 + 2 = 4**.
2. **Fork A** – choose **×2** (duplicate and combine) or **+4** – both make **8**.
3. Curved, banked elevated road with candy curbs, a neon ring **tunnel**, a rainbow and an
   **overpass** over the start straight.
4. **Boost pad → ramp → gap**: a spinning jump over the clouds.
5. **Bounce zone**: wobbling jelly bumpers (two of them sway) and a trampoline.
6. **÷2 portal**: 8 splits into two living **4**s; your companion runs beside you.
7. **Floating tiles** with open edges (fall off and you are rescued automatically).
8. **JOIN** arch: **4 + 4 = 8**.
9. **Fork B** – **+2** (→ 10) or **−3** (→ 5; the 3 bounces away).
10. Golden **×10 finale**: shining zeros fly in and click onto your number (**10 → 100**),
    with a big-number celebration.

From lap 2 the forks offer **×2 / ×10**, so you can grow 100 → 1,000 → … → 1,000,000 →
1,000,000,000 (the prototype's maximum), or follow the doubling path.

All maths lives in `src/math` and is independent of rendering. The character always shows the
team's real value; animations only visualise results that the maths engine already computed.

## Run locally

Requires Node.js 20+ (developed with Node 24).

```bash
npm install
npm run dev        # http://localhost:5173 (also printed with your LAN address)
npm test           # unit + gameplay simulation tests
npm run build      # type-check + production build into dist/ (with service worker)
npm run preview    # serve the production build on http://localhost:4173
```

Useful URL options: `?debug` (FPS, draw calls, position), `?quality=high|medium|low`
(otherwise quality adapts automatically when the frame rate drops).

## Installing on an iPad (offline PWA)

Service workers (offline mode) only work on **HTTPS** with a trusted certificate (or on
`localhost` on the same device), so the simplest route is to host the static `dist/` folder:

1. `npm run build`
2. Upload `dist/` to any static HTTPS host – e.g. GitHub Pages (Settings → Pages), Netlify
   Drop or Cloudflare Pages. Relative paths are used, so a sub-folder such as
   `https://<user>.github.io/misha-number-rush/` works.
3. On the iPad open the URL in **Safari**, wait a few seconds for it to finish loading,
   then **Share → Add to Home Screen**.
4. Launch it from the Home Screen once while online; afterwards it runs fully offline
   (try Airplane Mode).

Quick testing without installing: run `npm run dev`, open the printed `http://<LAN-IP>:5173`
address in Safari on an iPad on the same Wi-Fi. Everything except offline caching works.

## Project layout

```
src/math/         numberMath.ts (operations, formatting, words), team.ts (split/join state)
src/game/         course.ts (track data), raceLogic.ts (headless physics + gates),
                  transforms.ts (merge/split/zero animations), game.ts (orchestration),
                  cameraRig.ts, input.ts, trackPath.ts
src/render/       numberCharacter.ts, glyphs.ts, trackMesh.ts, environment.ts, items.ts,
                  particles.ts, sweep.ts, palette.ts
src/audio/        sound.ts (procedural Web Audio effects + music)
src/ui/           hud.ts, styles.css
tests/            maths, course invariants and full-lap route simulations
scripts/          build-font.mjs (font → 3D glyph JSON), make-icons.mjs (app icons)
```

## Assets and licences

- **Fredoka** typeface (SIL Open Font License 1.1, © The Fredoka Project Authors) via
  `@fontsource/fredoka`; used for the UI and converted to 3D glyph outlines in
  `src/assets/fredoka-bold.typeface.json` by `npm run font`.
- **three.js** (MIT), **Vite** (MIT), **vite-plugin-pwa / Workbox** (MIT).
- Characters, track, scenery, effects, icons, sound effects and music are generated
  procedurally by this project's code. No third-party models, textures or audio files are used.

## Known limitations

- Performance and touch feel have been checked in a desktop browser with tablet-sized
  viewports only; they still need verification on a real iPad (target 60 FPS, adaptive quality
  is in place).
- No number narration yet (postponed until high-quality offline voice clips are available).
- One track; values above one billion are not supported (gates fall asleep instead).
