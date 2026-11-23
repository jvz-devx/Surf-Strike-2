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

Zones render as CS-style glowing outlines: start green, end red, stages and checkpoints blue. Only race modes draw start/stage/checkpoint outlines; other modes (Zombies) use checkpoints internally and draw only the end zone.

### Glass

A material with `glass: true` (and/or `opacity` below 1; glass defaults to 0.3) is see-through: the renderer draws it blended after opaque geometry, from both sides, without depth writes, with a bright fresnel rim; give it an `edgeColor` so its outline reads. Collision is unchanged: glass is as solid as any brush (walls, ceilings, floors, even a surfable glass ramp).

### Fake brushes

Any brush may set `solid: false`: it is rendered exactly like a solid brush (same material, no hint) but `buildCollisionWorld` skips it, so players walk through it. Hide and seek maps use it for clip-through walls, hedges and hollow props (Hammer's `func_illusionary`). A teleport zone with `dest` moves the player to that fixed spawn (secret passages).

### Hard-surf obstacles

`maps/surf-obstacles.ts` has generic builders for obstacles placed ON the intended line (unlike scenery, which keeps ≥ 256 from it): `wallWithHole()` (window or narrow slot in a thick wall), `floorWithHole()` (drop through a slab), `glassPanel()`, `pillar()`, `orientedBox()` (box at any heading; a `convex` brush off-axis), `spiralSteps()` (downward spiral peak steps for `rampChain`). Each obstacle lists the openings (`Gate`s) its intended line flies through. The same module has a route bot (`runRouteBot`: rides chains at a target face fraction, flies transfers with no input, steering to an aim point, through gates, or with a full-rate air-strafe turn) and `gateCrossing()`, so map tests prove with the real physics that a skilled line passes every hole and that sloppier lines (offset, ±15% speed, no air strafe) hit the obstacles.

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

## surf_kessler — hard surf, staged (6 stages)

Theme: derelict orbital station at night, one neon colour per module. Each stage has its own signature obstacle (details and numbers in `surf_kessler.ts`):

1. Window in a bulkhead between the first two ramps, then twin pillars on the flight to the next platform.
2. A 224 × 256 window between a 120° right curve and a 90° left curve, low ceiling ribs over the second curve.
3. A 540° downward spiral (radius 1200 → 2600) around a reactor core, then a glass floor with a hole: drop through onto the ramp under it.
4. A 70° wall-surf face inside a glass corridor (glass wall beside it, glass lid over it), exit through a hole in a bulkhead.
5. A 130° air-strafe turn through two offset windows, then a 160-wide slot between narrow ramps.
6. A long steep descent, pillars in the long gap, and a final hole into the closed end room.

## surf_ochre — hard surf, linear

Theme: desert canyon at golden hour. Checkpoints are splits; any fall resets to the start. Nine hard moments: a narrow slot in a canyon fin, low arches over a bend, a 450° sinkhole spiral, a glass floor hole onto a ramp below it, hoodoo pillars to strafe around, two glass tubes over switch transfers (one switch ramp is glass), a far speed window off a wave, an up-ramp into a high window followed by a 130° air turn, and arches over the final descent.

## zombies_lowtide — zombies, linear

Theme: an abandoned seaside town at dusk in sea fog. Beach car park (start) → main street with side pockets and a barricade → narrow alley → promenade and a bridge over a creek → cannery yard → harbour road → pier with the evac boat. Five gates split it into six zones, each with a checkpoint and an unlock area before its gate. Zombies maps add `zombies: { path, spawnZones, gates }` (`ZombieRoute` in `maps/types.ts`): the waypoint route the AI follows, zombie spawn areas tagged with the route node they feed, and the gates (solid boxes outside `brushes`, an `unlock` area and a route `node`). Map tests check spawns, checkpoint respawns, waypoints and spawn areas stand free, and walk the whole route with the real movement at the slowest weapon speed; shared tests send a zombie from every spawn area to the evac point.

## Default map

The server and solo mode start on `surf_aurora`.
