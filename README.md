# Traffic Flow

A top-down traffic-management puzzle for the browser. Cars drive on their own; you control
the traffic lights. Keep the flows moving, avoid collisions, and clear each level's goal.

Built with **TypeScript + Phaser 3 + Vite**. All graphics and sounds are procedural — no
external assets.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build
npm run test     # Vitest unit + simulation tests
```

## How to play

| Action | Mouse | Touch |
| --- | --- | --- |
| Switch a light RED ⇄ GREEN | click the signal (or its stop line) | tap |
| YELLOW — let exactly **one** car through, then back to RED | hold ~0.4 s or right-click | long-press |
| Pause | ⏸ button (auto-pauses when the tab is hidden) | ⏸ button |

* **RED** — cars stop at the stop line; nobody enters the junction.
* **GREEN** — the whole flow goes and the light stays green until you switch it.
* **YELLOW** — one car (the first in line, only when its path through the junction is clear) passes,
  then the light turns RED by itself.

A crash ends the level. Levels with a time limit are lost when the clock runs out.
Pulsing red circles warn about conflict zones that two cars are about to share.

### Scoring and stars

`src/config/balanceConfig.ts → SCORE`

* +100 per car that reaches an exit, bonuses for finishing under par time, low average wait and no crashes.
* Penalties: crash, cars waiting longer than 15 s, blocked spawn points (queues backing up off-screen).
* Stars (max 5, win only): complete · under par time · average wait target · nobody waited too long · score target.
  Targets are per level (`stars` in each level file) and listed on the result screen.

## Levels

| # | Name | Layout | Cars | Limit |
| --- | --- | --- | --- | --- |
| 1 | First Crossing | 4-way crossing, 2 straight flows, 2 lights | 12 | – |
| 2 | Busy Road | T-junction, 3 approaches with turns | 20 | – |
| 3 | City Traffic | full 4-way, left/right turns, 4 lights | 28 | – |
| 4 | Double Crossing | two junctions on one avenue, queues between them | 30 | 2:30 |
| 5 | Rush Hour | two 4-way junctions, 6 entries, 8 lights | 38 | 3:00 |

Every level is verified winnable in `tests/solvability.test.ts` by an adaptive signal controller.

## Architecture

```
src/
  main.ts                    Phaser bootstrap
  config/                    gameConfig (Phaser), balanceConfig (tuning + scoring), theme (colours/fonts)
  types/                     shared types and enums (LightState, VehicleState, LevelDef…)
  entities/                  Vehicle (IDM car-following), TrafficLight (state machine), Road, Intersection
  systems/
    TrafficSimulation.ts     fixed-step deterministic simulation — no Phaser dependency
    PathSystem.ts            waypoints → Bézier-rounded, uniformly resampled paths + curve speed profile
    RouteNetwork.ts          runtime routes with bound stop lines and conflict zones
    TrafficLightSystem.ts    lights, route binding, player actions, change events
    CollisionSystem.ts       conflict-zone generation/occupancy, safe-entry checks, OBB (SAT) crash detection
    VehicleSpawner.ts        seeded, deterministic flows
    ScoreSystem.ts           score, penalties, stars, result
    SaveManager.ts           localStorage profile with validation/recovery
    LevelManager.ts          level order and unlocks
    AudioManager.ts          procedural Web Audio sound effects
    AutoPilot.ts             adaptive signal controller (menu demo + solvability tests)
  levels/                    builder helpers, level01–05, registry
  render/                    WorldRenderer (baked static map, pooled car sprites, lights), procedural textures
  scenes/                    Boot, Menu, LevelSelect, Game, Result
  ui/                        Button, LevelCard, HUD, Modal, shared UI helpers
  utils/                     math (seeded RNG), geometry (vectors, Bézier, OBB), wall-clock frame timer
tests/                       Vitest suites
```

Key design points:

* **Simulation / rendering split.** `TrafficSimulation` runs at a fixed 60 Hz step from an accumulator,
  independent of the frame rate, and is fully deterministic (seeded RNG, ordered updates). Scenes only read it.
* **Driving model.** A simplified Intelligent Driver Model: smooth acceleration, comfortable braking,
  emergency braking, time headway and minimum gap. Curve speed comes from path curvature.
  Leaders are found geometrically, so car-following also works where routes share or merge lanes.
* **Conflict zones** are generated automatically wherever two routes from different entries cross or merge.
  They are used for the yellow single-pass rule, the "don't launch into an occupied junction" check for
  cars standing at the line, the danger indicator and the auto-pilot. Crashes themselves are detected
  physically with oriented rectangles, so they work on straights and in turns.
* **Mobile.** Resizable canvas, two-camera layout (zoomed world + 1:1 UI), wide maps rotate 90° on tall
  portrait screens, touch areas of at least ~34 px radius with nearest-light picking, no keyboard needed.
