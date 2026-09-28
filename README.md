# Traffic Flow

A top-down traffic-management puzzle for the browser. Vehicles drive on their own; you control
the traffic lights. Keep the flows moving, avoid collisions, and clear each level's goal.

Built with **TypeScript + Phaser 3 + Vite**. All graphics and sounds are procedural — no
external assets. English and Russian interface, installable as an app, works offline.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/ (with service worker)
npm run preview  # serve the production build (offline mode works here)
npm run test     # Vitest unit + simulation tests
npm run icons    # regenerate the PWA PNG icons
```

## How to play

| Action | Mouse | Touch |
| --- | --- | --- |
| Switch a light RED ⇄ GREEN | click the signal (or its stop line) | tap |
| YELLOW — let exactly **one** car through, then back to RED | hold ~0.4 s or right-click | long-press |
| Zoom | mouse wheel / trackpad pinch | two-finger pinch |
| Move the map | drag | drag |
| Fit the whole map again | ⛶ button in the top bar | ⛶ button |
| Pause | ⏸ button (auto-pauses when the tab is hidden) | ⏸ button |

* **RED** — cars stop at the stop line; nobody enters the junction.
* **GREEN** — the whole flow goes and the light stays green until you switch it.
* **YELLOW** — one car (the first in line, only when its path through the junction is clear) passes,
  then the light turns RED by itself.
* **Slip lanes** (free right turns, marked with shark teeth and a yield sign) ignore the lights: those
  cars wait for a gap in the traffic they merge into.
* **Buses and trucks** are long and slow to accelerate, and a bus is worth more points.
* **Emergency vehicles** (ambulance, police, fire engine) arrive with flashing beacons and a siren;
  every second they stand still costs points.

A crash ends the level. Levels with a time limit are lost when the clock runs out.
Pulsing red circles warn about conflict zones that two vehicles are about to share.

### Scoring and stars

`src/config/balanceConfig.ts → SCORE`, points per vehicle kind in `VEHICLE_SPECS`.

* Points for every vehicle that reaches an exit (car 100, truck 150, bus 250, emergency 300), bonuses for
  finishing under par time, low average wait and no crashes.
* Penalties: crash, vehicles waiting longer than 15 s, emergency vehicles standing still, blocked spawn
  points (queues backing up off-screen).
* Stars (max 5, win only): complete · under par time · average wait target · nobody waited too long ·
  score target. Targets are per level and listed on the result screen.

## Levels

| # | Name | What's new | Vehicles | Limit |
| --- | --- | --- | --- | --- |
| 0 | Driving School | guided tutorial with step-by-step hints | 8 | – |
| 1 | First Crossing | 4-way crossing, 2 straight flows | 12 | – |
| 2 | Busy Road | T-junction, turning traffic | 20 | – |
| 3 | City Traffic | full 4-way with left/right turns | 28 | – |
| 4 | Double Crossing | two junctions, queues between them | 30 | 2:30 |
| 5 | Rush Hour | two 4-way junctions, 6 entries | 38 | 3:00 |
| 6 | Two-Lane Avenue | two lanes each way, buses | 34 | – |
| 7 | Slip Lanes | free right turns that yield, trucks | 32 | – |
| 8 | Sirens | emergency vehicles on call | 36 | 2:30 |
| 9 | Grand Boulevard | everything together | 55 | 3:20 |

Every level (and editor-made grids) is verified winnable in the tests by an adaptive signal controller.

## Level editor

Menu → **Editor**. Tap the map to lay horizontal or vertical roads (up to 3 each way), switch a road
between 1 and 2 lanes per direction, or erase it. **Traffic** sets vehicles per entry, density, buses,
trucks, emergency vehicles, slip lanes and a time limit. Junctions, signals, routes (straight, left and
right turns) and flows are generated automatically.

* **Test** plays the level; **Check** lets the autopilot try it and reports whether it is solvable.
* **Share** shows a `TF1:…` code to copy; paste someone else's code there and press **Load**.
* Three save slots, stored in the browser.

## Records

Every win is added to a per-level top-10 table (name set in Settings). The table is stored on the
device. When the game runs as a published claude.ai page that has been granted a shared database, the
same table is also shared between everyone who plays that page; otherwise it simply stays local.

## Offline / install

`npm run build` generates `dist/sw.js` with the exact list of built files. After the first visit the
whole game is cached and runs without a network; the browser can install it as an app
(`manifest.webmanifest`, icons in `public/icons`). The menu shows an **Install app** button when the
browser offers installation. Service workers only run on `https://` or `localhost`.

## Architecture

```
src/
  main.ts                    Phaser bootstrap, PWA init
  pwa.ts                     service worker registration, install prompt
  config/                    gameConfig (Phaser), balanceConfig (tuning, vehicle specs, scoring), theme
  i18n/                      t() with {param} interpolation, en/ru tables, Russian plurals
  types/                     shared types (LightState, VehicleState, LevelDef, TutorialStep…)
  entities/                  Vehicle (IDM car-following), TrafficLight (state machine), Road, Intersection
  systems/
    TrafficSimulation.ts     fixed-step deterministic simulation — no Phaser dependency
    PathSystem.ts            waypoints → Bézier-rounded, uniformly resampled paths + curve speed profile
    RouteNetwork.ts          runtime routes with stop lines, conflict zones, slip-lane start
    TrafficLightSystem.ts    lights, stop-line binding across all lanes, player actions
    CollisionSystem.ts       conflict zones, safe-entry checks, OBB (SAT) crash detection
    VehicleSpawner.ts        seeded flows with vehicle mixes, scheduled emergency vehicles, per-lane clearance
    ScoreSystem.ts           points, penalties, stars
    TutorialController.ts    scripted tutorial steps
    Leaderboard.ts           records (local + optional shared)
    SaveManager.ts           localStorage profile with validation/recovery
    LevelManager.ts          level order, unlocks, shared stores
    AudioManager.ts          procedural Web Audio sound effects (incl. siren)
    AutoPilot.ts             adaptive signal controller (menu demo, editor check, solvability tests)
  editor/                    EditorModel (roads → level, share codes), EditorStore (save slots)
  levels/                    builder (lanes, slip lanes, lights), level00–09, registry
  render/                    WorldRenderer, CameraController (zoom/pan/rotation), procedural textures
  scenes/                    Boot, Menu, LevelSelect, Game, Result, Records, Editor
  ui/                        Button, LevelCard, HUD, Modal, TutorialOverlay, DOM text dialog, UI helpers
  utils/                     math (seeded RNG), geometry (vectors, Bézier, OBB), wall-clock frame timer
scripts/generate-icons.mjs   procedural PNG icon generator
tests/                       Vitest suites
```

Key design points:

* **Simulation / rendering split.** `TrafficSimulation` runs at a fixed 60 Hz step from an accumulator,
  independent of the frame rate, and is fully deterministic (seeded RNG, ordered updates).
* **Driving model.** A simplified Intelligent Driver Model: smooth acceleration, comfortable and emergency
  braking, time headway and minimum gap; curve speed from path curvature. Leaders are found
  geometrically, so car-following also works where routes share lanes or merge.
* **Lanes.** Lane 0 is the curb lane; left turns start from the inner lane. A light's stop line spans all
  inbound lanes and binds to every route that crosses it.
* **Conflict zones** are generated wherever two routes from different entries cross or merge. They drive
  the yellow single-pass rule, the "don't launch into an occupied junction" check, slip-lane yielding, the
  danger indicator and the auto-pilot. Crashes are detected physically with oriented rectangles.
* **Mobile.** Resizable canvas, two cameras (zoomed world + 1:1 UI), wide maps rotate 90° on tall screens,
  pinch/drag with tap-vs-drag disambiguation, large nearest-light touch targets, no keyboard needed.
