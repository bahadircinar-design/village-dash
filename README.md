# Village Dash: Bring the Pup Home

A fast, friendly first-person 3D browser game. A happy pup has slipped its leash and is
zooming through a sunny village of white stucco alleys. Ride your electric dirt bike, chase
it through narrow streets, dirt lots and orchards, and catch it **gently** to bring it home.

Built with Three.js (r160, stored locally in `vendor/`). It's a static site with no build step and runs offline.
All art, sound and music are generated in code. There are no external assets and no brands.

## Run it

```bash
cd /workspace/village-dash
python3 -m http.server 5184
# open http://localhost:5184
```

Any static file server works. ES modules need http://, so opening `index.html` directly from disk won't work.
To play on a phone, serve it on your LAN and open `http://<your-ip>:5184`.

## Controls

| Action | Keyboard | Touch | Gamepad |
|---|---|---|---|
| Throttle | W / ↑ | **GO** button | RT or A |
| Brake / reverse | S / ↓ | **BRAKE** button | LT or B |
| Steer | A D / ← → | Left steering pad (drag) | Left stick |
| Drift (handbrake) | Space (or Left Shift) | **DRIFT** button | X or RB |
| Reset onto street | R | n/a | Y |
| Pause | Esc / P | ❚❚ button | Start |
| Mute | M | 🔊 button | n/a |

The top-right buttons also switch quality (HQ/LQ) and mute.

## How to catch the pup (it is never hurt)

- **Match its speed**: stay within about 2.5 m of the pup at a similar speed for about 1 second. A "Catching…" meter fills up.
- **Corner it**: if it ducks into a dead-end alley, block the alley and ease in slowly.
- **Find its hiding spot**: when it gets tired, it runs to the **red car** in a cul-de-sac and hides underneath. Ride up to the car.
- The bike brakes for you automatically right behind the pup, so you can't run into it.
  You get a "Got you, buddy!" moment, the pup sits and wags, and the rider turns to look at it.

## Features

- **First-person e-bike feel**: wide FOV (about 105° horizontal) with a cheap barrel/fisheye post shader and vignette.
  The camera bobs, leans into turns, bounces with the suspension and shakes on impacts, and the FOV widens with speed.
  A low-poly handlebar rig is always on screen: bars, gloved hands, forks, number plate and front wheel. The bars turn with steering.
- **Yellow handlebar device**: an in-world screen (canvas texture) showing speed, distance to the pup,
  a direction arrow and the timer. The screen-space HUD is minimal: timer and par stars, pup distance and status, and speed.
- **Arcade physics**: strong acceleration and braking, and steering that tightens at low speed. The handbrake drift
  lets the rear slide out for sharp 90° turns, with a skid sound, tire-mark decals and smoke/dust puffs.
  - Surfaces: pavement is grippy and fast, dirt is loose, bumpy and slower, grass is in between.
  - Collisions with walls, cars, poles, crates and trees bump you, cost speed and shake the camera.
    A heavy crash adds a 3 s penalty. There is never a game over.
- **Dog AI**: runs on a navigation graph of the streets.
  - It picks erratic branches at intersections, prefers narrow alleys when you're close, cuts across fields, and sometimes ducks into dead ends.
  - It sprints when you're close, tires over time, and waits for you if you fall far behind.
  - When it's worn out, it heads for its hiding spot under the red car.
  - A screen-edge arrow with the distance points to it when it's off screen, and a "PUP" tag marks it when it's far away.
  - It has a procedural running cycle, sit and crouch poses, a wagging tail and floppy ears.
- **Procedural village** from a 1 m occupancy grid. Visuals, collisions and surface types all come from the same grid.
  - Streets: a 3–5 m alley grid with removed links and dead-end stubs.
  - Buildings: white or beige stucco boxes with flat roofs, parapets, doors, windows, sills, shutters, AC units and rooftop water tanks.
  - Street props: parked cars, poles with sagging wires, crates, potted plants, bushes and people sitting outside on chairs (static props).
  - Fields: dirt lots with bumps and mounds, and orchards with fruit trees. A clear-lane rule keeps every street ridable.
  - Lighting: bright sun, soft shadows that follow you, light fog, a sky gradient with a sun glow, and clouds.
- **3 levels** (fixed seeds, so best times are fair):
  1. **Village**: par 0:55
  2. **Market Alleys**: narrower lanes, awnings, market stalls and crates, and a faster, more erratic pup. Par 1:00
  3. **Orchard Run**: a bigger map with orchards, dirt tracks and bumpy fields, and the fastest, trickiest pup. Par 1:35
  - Stars: at or under par = ★★★, up to 1.5× par = ★★, otherwise ★.
  - Best times are saved to `localStorage`.
- **Screens**: start screen with level select, best times and stars, a countdown, pause (resume, restart, menu),
  and a results screen (time, par, stars, best time and new-best badge, how the pup was caught, crash penalties,
  next level, retry, menu).
- **Audio** (all WebAudio synthesis, no files):
  - Electric motor whine whose pitch follows speed
  - Tire skid, dirt crunch, wind, bump thuds and synthesized barks
  - A catch jingle
  - A 124 bpm procedural electronic loop (kick, hats, clap, bass arpeggio, pluck melody)
  - Mute toggle, which is remembered
- **Mobile**: on-screen steering pad plus GO, BRAKE and DRIFT buttons. Works in portrait (9:16) and landscape,
  with safe-area insets. The FOV adapts to the aspect ratio.
- **Performance**:
  - Instanced meshes for all buildings and props (about 2–5k instances in 5 draw calls)
  - One ground mesh with a generated texture
  - A modest shadow map: 2048 on HQ, 1024 on LQ, with a frustum that follows the bike
  - Pixel ratio capped at 2 on HQ and 1.25 on LQ, with MSAA only on HQ
  - A quality toggle. Touch devices default to LQ.

## Files

```
index.html          UI, HUD, overlays, touch controls, styles
src/main.js         renderer, post pipeline, game state machine, camera, HUD, debug hooks
src/world.js        procedural level, instanced geometry, colliders, surfaces, height field
src/bike.js         bike physics and the first-person handlebar rig
src/dog.js          pup model, animation and nav-graph AI
src/audio.js        WebAudio synth: motor, skid, dirt, bumps, barks, music
src/input.js        keyboard, touch, gamepad
src/fx.js           tire marks, dust, fisheye post shader
src/hud.js          handlebar device screen drawing
src/levels.js       level configs and star thresholds
src/util.js         helpers
vendor/three.module.js
tools/test.py       headless Chrome end-to-end test and screenshots (Playwright, SwiftShader)
tools/bot.py        pursuit autopilot used to sanity-check pars
screenshots/        test screenshots
```

## Testing

```bash
/workspace/pwenv/bin/python tools/test.py          # 24 checks + screenshots
/workspace/pwenv/bin/python tools/bot.py           # autopilot playthroughs per level
```

`window.__vd` exposes the game state. `__vd.debug.step(seconds)` advances the simulation
deterministically without rendering. The tests use it because software WebGL renders only about 2 fps.
