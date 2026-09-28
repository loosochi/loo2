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

## Campaign 2.0 — building roads

**PLAY** starts the road-building campaign (the tutorial first for new players). Every level needs an
infrastructure decision; traffic only runs once the network is valid.

* **Modes** (bottom bar): **BUILD** — traffic is frozen, the toolbar is shown; **TRAFFIC** — the
  simulation runs, tap lights to switch them; **STATS** — traffic runs with a load overlay
  (LOW / MEDIUM / HIGH / CRITICAL) and tap-to-inspect.
* **Tools**: ROAD (tap → drag → release; live VALID / INVALID preview with length, cost and the reason;
  snapping to nodes, roads and the grid; straight in 8 directions, L-shaped otherwise; automatic
  junctions), DELETE (with "DELETE ROAD?" confirmation; fixed roads and roads with cars are refused),
  TRAFFIC LIGHT (tap a junction approach), LANE (1–3 per direction, tap a side of the road), DIRECTION
  (two-way → one-way → other way), INTERSECTION (right of way: auto / all-way / chosen main road),
  INSPECT, plus UNDO / REDO, GRID and SNAP toggles. Levels lock tools they do not need.
* **Budget**: AVAILABLE / COST / REMAINING. Road $100 per 40 units, light $500, lane $700, junction
  change $1000, delete free (`BUILD_COSTS` in `balanceConfig.ts`). Unspent money gives bonus points.
* **Objectives** per level: PASS_CARS, PASS_CARS_WITHOUT_CRASH, MAX_WAIT_TIME, MAX_QUEUE_LENGTH,
  BUDGET_LIMIT, BUILD_LIMIT, EMERGENCY_PRIORITY, TIME_LIMIT — shown live and on the result screen.
* **Inspector**: road (length, lanes, direction, load, average speed, vehicles/min), light (state,
  incoming, queue), junction (vehicles/min, average delay, most used movement, conflict points).
* **Debug overlay**: pause → DEBUG (or F3): FPS, counts, active conflict zones, queues, wait, density,
  mode, budget, route compile time; switches for zones, paths, nodes, lanes, arrows, entries, exits.

| # | Name | Decision |
| --- | --- | --- |
| 1 | Simple Crossing | add lights to a priority crossing |
| 2 | Three Ways | choose the main road of a Y junction |
| 3 | Missing Link | build the road that connects drivers to their exit |
| 4 | T-Junction | signal a T junction |
| 5 | Tight Budget | only three of four lights are affordable |
| 6 | Twin Junctions | signal only the side streets |
| 7 | Wrong Way | reverse a one-way street |
| 8 | Lanes | widen the approach |
| 9 | Siren Street | clear the way for emergency vehicles |
| 10 | City Grid | lights in the right places of a 4-junction grid |

Every campaign level is checked by the tests: doing nothing fails (or cannot even start) and the
reference solution wins within budget, without crashes, with all objectives complete.

## Level editor

Menu → **CREATE** (or LEVELS → MY LEVELS). The editor uses the same road tools plus ENTRY, EXIT and
DECOR, with an unlimited budget. Top bar: **NEW / LOAD / SAVE / COPY / DELETE / RULES** and
**TEST LEVEL**; tap the name to rename. The inspector edits an entry's vehicle count, rate, types and
emergency vehicles. **RULES** sets the player's budget, time limit, maximum wait and allowed tools.

* Every change autosaves; levels are stored in `localStorage` (`traffic-flow.custom-levels`) as
  `{ id, name, createdAt, updatedAt, schemaVersion: 2, map: { world, seed, network }, rules, budget }`.
* **TEST LEVEL** validates the level first (entries, exits, routes, connected roads, lights on real
  approaches, geometry) and reports the first problem. After the test: **EDIT / RESTART / BACK**.
* **LOAD** lists your levels and has **Share** (`TF2-…` codes). Levels from the old grid editor are
  converted automatically on first start.

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
    ObjectiveTracker.ts      level objectives (live status, pass / fail)
  graph/                     RoadNetwork (nodes/edges/lanes, auto junctions), PathFinder (A*, cached),
                             NetworkCompiler (network → routes, lanes, turns, lights, right of way), geometry
  building/                  BuildManager (tools as commands), RoadBuilder (snapping, polylines),
                             BuildValidator (geometry), BudgetSystem
  history/                   CommandHistory (undo / redo with snapshots)
  analytics/                 TrafficAnalytics (queues, waits, density, speed, utilization, per road/junction/light)
  editor/                    CustomLevelStore (custom levels, migration, TF2 codes), LevelValidator,
                             EditorModel / EditorStore (old grid editor, kept for migration)
  levels/                    builder, classic level00–09, campaign/ (Campaign 2.0, ids 101–110), registry
  render/                    WorldRenderer, NetworkPainter, NetworkOverlay (grid, preview, load, debug),
                             CameraController (zoom/pan/rotation), procedural textures
  scenes/                    Boot, Menu, LevelSelect, Game, Result, Records, Editor; build/BuildController
  ui/                        Button, LevelCard, HUD, Modal, BuildToolbar, InspectorPanel, ObjectivesPanel,
                             DebugPanel, TutorialOverlay, DOM text dialog, UI helpers
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
* **Road networks (schema 2).** A level may carry a `network` (nodes, edges with lanes per direction,
  lights per junction approach, entries, exits). `NetworkCompiler` turns it into the same routes / lights
  / flows the simulation always used, so classic levels (schema 1) run unchanged. After every build the
  level is recompiled once (never per frame; A* results are cached per graph version) and hot-swapped
  into the running simulation: cars already driving keep their routes, lights keep their state.
* **Right of way.** Unsignalled junctions have a main road (automatic or chosen); other movements give
  way, accept a gap only when the whole junction path is clear, and never stop halfway across. Cars with
  priority — and cars on green — still do not drive into a vehicle that is inside the junction.
