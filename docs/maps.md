# Maps

Nine original maps across three gamemodes: surf_aurora (easy), surf_ember, surf_skyrend (staged, 7 stages), surf_hadal (linear, 8 sections); bhop_meadow (easy), bhop_circuit, bhop_reliquary (sunken temple), bhop_rimefall (night glacier); tag_quayside (harbour town, see [modes.md](modes.md)). The four original designs are described below; the newer maps document their layout in their source files. Each has its own theme. None of them copies an existing community map; they use the genre's standard building blocks (surf ramps, transfers, bhop blocks).

## Map format

Maps are TypeScript modules in `packages/shared/maps/`, built from code so both client and server can load them without file downloads.

```ts
interface MapDef {
  id: string;                  // "surf_aurora"
  title: string;               // "Aurora"
  kind: GameModeId;            // the gamemode: 'surf' | 'bhop' | 'tag' (modes.md)
  difficulty: 'easy' | 'hard';
  layout: 'linear' | 'staged' | 'open';  // 'open' = tag maps
  cvars: Partial<Cvars>;       // overrides on top of the mode's profile (physics.md, modes.md)
  spawn: { pos: Vec3; yaw: number };     // race: in the start zone; tag: fallback spawn
  spawns?: Spawn[];            // tag (required, >= 8): random spawns for joins and fall-outs
  brushes: Brush[];            // solid convex brushes
  zones: Zone[];               // start, end, stage/checkpoint, teleport
  theme: Theme;                // sky, fog, palette, lights, materials
}

type Brush =
  | { type: 'box'; min: Vec3; max: Vec3; material: string }
  | { type: 'ramp'; /* triangular prism: base, length, height, side */ material: string }
  | { type: 'convex'; planes: Plane[]; material: string };

type Zone =
  | { type: 'start' | 'end'; min: Vec3; max: Vec3 }
  | { type: 'stage' | 'checkpoint'; index: number; min: Vec3; max: Vec3; respawn: { pos: Vec3; yaw: number } }
  | { type: 'teleport'; min: Vec3; max: Vec3; to: 'stage' | 'start' };
```

Helper functions (`ramp()`, `platform()`, `wall()`, `blockRow()`) keep map files readable. At load, each brush becomes collision planes plus a Three.js mesh. Materials are procedural (shader noise, triplanar mapping), so there are no texture files.

Zones render as CS-style glowing outlines: start green, end red, stages and checkpoints blue.

Race-only rules (one start and one end zone, spawn in the start zone, contiguous stages/checkpoints) apply to race modes. A tag map (`kind: 'tag'`) has `layout: 'open'`, at least 8 `spawns` that stand free on walkable ground in the real collision trace, and only teleport zones, with one under everything. In tag, every teleport zone respawns the player at a random spawn, whatever its `to` says. `mapsForMode(mode)` lists the rotation maps of one mode. `maps/maps.test.ts` checks all of this.

## surf_aurora — easy surf, linear

Theme: dusk over a snowy valley. Aurora ribbons in a dark-blue sky gradient, ice-blue ramps with frosted edges, soft fog.

- Start platform with a drop onto the first ramp.
- 6 long, wide ramp pairs (left/right) at gentle angles (about 50–55° from horizontal).
- Each pair is an open V: the base edges are 128 units apart, so a player who stops surfing falls through the middle (no free slide down a closed crease). The start platform and respawn ledges drop onto the left ramp's face.
- Generous gaps between ramps; every transfer is straight ahead.
- 3 checkpoint zones for splits.
- Falling to the valley floor teleports to the start and resets the timer.
- Target time for a new player: 1:30–2:00.

## surf_ember — surf, staged (rated easy)

Theme: volcanic canyon. Black basalt ramps with glowing orange seams, lava sea below, ember particles, orange haze.

- 6 stages, each with its own start zone and respawn.
- Steeper, narrower ramps (about 60–65°).
- Transfers that need a turn in the air, one up-ramp that needs speed, one long gap that rewards speed from the previous stage.
- Falling into the lava teleports to the current stage start; the timer keeps running.
- Target time for a new player: 4:00+.

## bhop_meadow — easy bhop

Theme: floating grass islands at noon. Bright sky, soft clouds, stone blocks with moss tops.

- About 40 blocks in 5 sections, each section ending in a checkpoint.
- Wide blocks (128 × 128 units) with gaps of 96–160 units.
- Mostly straight lines with a few gentle turns.
- Falling teleports to the last checkpoint.
- Target time for a new player: 1:00–1:30.

## bhop_circuit — hard bhop

Theme: neon circuit board at night. Dark blocks with glowing cyan and magenta edges, grid floor far below.

- About 60 blocks in 6 sections, each ending in a checkpoint.
- Smaller blocks (64 × 64 units), gaps up to 240 units that need built-up speed.
- Sharp strafe turns, a few height changes, and narrow strips.
- Falling teleports to the last checkpoint.
- Target time for a new player: 2:30+.

## Default map

The server and solo mode start on `surf_aurora`.
