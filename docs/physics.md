# Physics

Movement copies Counter-Strike 2 as closely as public evidence allows: a fixed 64-tick step (15.625 ms) with **subtick input**, CS2's movement changes on top of a port of Source's `CGameMovement`, and the CS2 surf/bhop server cvars of the SharpTimer configs. All units are Hammer units (1 unit = 1 inch); the renderer converts them to metres. Code: `packages/shared/src/movement/gamemovement.ts`.

CS2 is closed source. Sources used, best first:

- **[S8]** ValveResourceFormat `Renderer/Input/PlayerMovement.cs`: a reverse-engineered CS2 movement controller (midpoint integration, friction/accelerate, modern jump, landing penalty constants, duck model).
- **[S2]** zer0.k, "Bunnyhopping in CS2": a reverse-engineering write-up checked with ~130,000 bot landings (subtick splits, bhop window, restore, spam penalty, landing time, WalkMove clamp, 286 cap).
- **[S4]** cs2kz `vnl` mode and **[S6]** cs2surf mode headers: the full CS2 movement cvar list and their vanilla/surf values.
- **[S5]** SharpTimer CS2 surf and bhop server configs: the values used here.
- **[S7]** CS2 patch notes (2025-11-04: "Fixed a case where air acceleration was clamped incorrectly while surfing").

## Tick and subtick

- `TICK_RATE = 64`. Each `UserCmd` holds the input at tick start plus `subtick`: the input changes inside the tick, each with `when` in [0, 1) (fraction of the tick) and the full button/move state after the change.
- `playerMove` splits the tick at every event. Each piece runs the whole move for its share of the tick (dt = (when₂ − when₁) × 15.625 ms): duck, jump check, walk/air move, then `CategorizePosition`. So a jump pressed 30% into a tick starts 30% into the tick, and the ground check runs at the end of every piece [S2].
- A press and release at the same instant (mouse wheel) still counts: the press is carried into the next non-empty piece.
- Jump press times are rounded to 1/64 of a tick before the spam and window checks [S2].
- The view angle is the one at tick time for the whole tick (`sv_subtick_movement_view_angles 0`, as on CS2 surf servers [S6]).
- Friction does not compound across pieces: the first ground friction of a tick stashes the speed, and later pieces take their drop from it (CS2 `m_flFrictionStashedSpeed`; the exact CS2 rule is not public, see Approximations).

### Subtick input capture (client)

`apps/web/src/lib/input/subtick.ts`. Every movement key change (`+forward/back/moveleft/moveright/jump/duck`, from keys, mouse buttons or the wheel) is recorded with its DOM `event.timeStamp`. Each frame, the fixed-step loop knows the wall-clock interval of every tick it runs (the newest tick ends `accumulator` ms before the frame). A tick takes the events inside its interval as subtick events, with `when` quantised to 1/64 tick (≈ 1/4096 s, CS2's resolution). Events that arrive after their tick already ran count at `when = 0` of the next tick; events after the tick end wait for a later tick. A mouse-wheel `+jump` is a press and a release with the same timestamp. A press and release inside one frame therefore always reach the simulation. The same timestamped key log gives identical ticks at any frame rate (tested at 60/144/240 FPS).

## Movement routines

From Source 2013 (unchanged): `TryPlayerMove` (4 bumps, crease handling, stop in 3+ plane corners), `ClipVelocity` (overbounce 1.0 plus the post-clip adjust), `StepMove` (18-unit step, keeps the move that went further), `StayOnGround`, `CategorizePosition` (2-unit ground probe plus the quadrant probes, never grounded above 140 u/s), per-axis `CheckVelocity`, `AirAccelerate` capping only the projection to `sv_air_max_wishspeed` (30), which is what makes air strafing and surfing gain speed.

CS2 changes [S8, S2]:

- **Midpoint integration.** Friction, acceleration and gravity act over the whole piece: half is applied before the position update and half after. Gravity is still half before, half after, as in Source.
- **Friction** uses the 2D speed: `drop = max(speed, sv_stopspeed) × sv_friction × dt`. Friction left over beyond the remaining speed comes off the acceleration.
- **Accelerate**: `accelspeed = sv_accelerate × max(250, wishspeed) × dt` (× 0.34 while ducking), capped by the wish-direction deficit.
- **Ground speed clamp.** After friction and acceleration, ground speed is clamped to the max speed (with the landing penalty and the duck slowdown). This is why a missed bhop loses speed at once.
- **Deadstrafe.** `CategorizePosition` sets the surface friction to 0.25 while airborne and rising at 0 < vz ≤ 140 u/s, and air acceleration is multiplied by it. A full jump keeps full air control until it slows to 140 u/s. Not applied while touching a surf plane (CS2 fix of 2025-11-04 [S7]).
- **Velocity clamp**: per axis to `sv_maxvelocity`, never past CS2's hard limit of 16384.
- Ground planes: `sv_standable_normal` (0.7) for the ground probe, `sv_walkable_normal` (0.7) for steps and stay-on-ground.

## Rules that make surfing work

- A surface counts as ground only when its normal `z >= 0.7`. Anything steeper is a surf ramp: the player slides along it in air-move state. 45° (normal z 0.707) is still walkable.
- The player counts as airborne while vertical velocity is above 140 u/s, so riding up a ramp never snaps to ground.
- Holding strafe into a ramp plus `ClipVelocity` keeps the player on the ramp; gravity pulls them down along it.
- No deadstrafe on a ramp: rising along a ramp at 0 < vz ≤ 140 keeps full air acceleration.

## Jump

- **Impulse.** `sv_jump_impulse` 301.993 (`sqrt(2 × 800 × 57)`). A standing jump loses a quarter tick of gravity (`impulse − 800 × 0.5 × 0.5 × dt`, the midpoint integration's share); a ducked jump gets the full impulse [S8]. Standing apex 55.83, jump while ducked 57.0, jump then duck in the air 64.83 (+9 duck lift).
- **Legacy jump** (`sv_legacy_jump 1`, all maps): CS:GO rules. A new press (or held jump with autobhop) while on ground jumps; a press in the air is not remembered. No landing penalty (stamina costs are 0).
- **Modern jump** (`sv_legacy_jump 0`; implemented but not used by the shipped profiles — the owner chose the legacy jump for bhop too, for full-height hops) [S8, S2]:
  - A landing is recorded only for a fall that touches down during a move. Its time is solved inside the piece from `z0 + v·t − g·t²/2`, with the landing velocity.
  - A press within ±`sv_bhop_time_window`/2 (±0.25 tick) of the landing counts as a bhop: if the landing speed was above the max speed, the landing horizontal velocity is restored (undoing the WalkMove clamp). Autobhop always restores. Other jumps wait a full tick after the landing.
  - An early press is kept only until the next piece, where it is checked against the last recorded landing (CS2's own buffering quirk [S2]).
  - `sv_jump_spam_penalty_time` (1 tick): a press this soon after the previous one is ignored, and still counts as the previous press.
  - **Landing penalty** (fitted constants, medium confidence): `pen = clamp(1 + vz_land × 0.0005, 0.2, 1)`; on the ground the max speed is scaled by `min(floor(ticks since landing) × dt × 1.1111894 + pen², 1)`; the next jump impulse by `min(pen + (seconds since landing + 1 tick) × 0.6, 1)`. A flat bhop landing at ~290 u/s gives max speed ×0.73 and jump ×0.87, so sustained autobhop hops reach ~44 units instead of 55.8.
- `sv_enablebunnyhopping 0`: speed capped at 286 (1.1 × 260, regardless of weapon) before the impulse. Both profiles use 1 (no cap).

## Duck (CS2 duck amount model) [S8]

- `duckAmount` 0..1 moves towards the duck key at `duckSpeed × 0.8` per second when ducking and `max(1.5, duckSpeed)` when standing up. `duckSpeed` is 8 ideally, loses 2 every time the duck key changes, and recovers 3/s (+6/s once 64 units from the last full-speed spot). Below 1.5 a new duck cannot start.
- On the ground the duck hull switches when the amount reaches 1 (~0.2 s for a fresh press: the first press already costs 2 duck speed); standing up switches back to the standing hull at once if there is room and the ducked flag drops at amount 0.75. `sv_timebetweenducks` (surf 0.4 s, bhop 0) delays a new duck after a completed one.
- In the air ducking and unducking are instant; the feet lift by 9 units (the hull shrinks around its centre) and drop back on unduck if there is room.
- Ground max speed is scaled by `lerp(1, 0.34, duckAmount)`; eye height is `64 − 18 × duckAmount`.

## Cvars

SharpTimer CS2 configs [S5], except `sv_maxspeed` 250 (knife run speed, no weapons) and `sv_autobunnyhopping` 1 on every map (owner's choice).

| Cvar | Surf maps | Bhop maps | Notes |
| --- | --- | --- | --- |
| `sv_accelerate` | 6.5 | 5 | Ground acceleration |
| `sv_accelerate_use_weapon_speed` | 0 | 0 | Knife only, so a no-op either way |
| `sv_airaccelerate` | 150 | 1000 | |
| `sv_air_max_wishspeed` | 30 | 30 | AirAccelerate projection cap |
| `sv_friction` | 5.2 | 4 | |
| `sv_stopspeed` | 80 | 80 | |
| `sv_gravity` | 800 | 800 | |
| `sv_maxspeed` | 250 | 250 | |
| `sv_maxvelocity` | 9876 | 99999 | Per axis; CS2 never exceeds 16384 |
| `sv_autobunnyhopping` | 1 | 1 | Hold jump to bhop |
| `sv_enablebunnyhopping` | 1 | 1 | No 286 cap |
| `sv_jump_impulse` | 301.993 | 301.993 | |
| `sv_legacy_jump` | 1 | 1 | Legacy vs modern jump (SharpTimer bhop uses 0; we use 1 for full-height hops) |
| `sv_bhop_time_window` | 0.0078125 | 0.0078125 | Modern jump only |
| `sv_jump_spam_penalty_time` | 0.015625 | 0.015625 | Modern jump only |
| `sv_jump_precision_enable` | 0 | 0 | Not simulated |
| `sv_timebetweenducks` | 0.4 | 0 | |
| `sv_standable_normal` / `sv_walkable_normal` | 0.7 | 0.7 | |
| `sv_staminamax` / `jumpcost` / `landcost` / `recoveryrate` | 80 / 0 / 0 / 60 | same | Stamina costs 0: no CS:GO stamina slowdown |
| `sv_stepsize` | 18 | 18 | |

Each map's definition sets its cvar profile. The server pushes cvars to clients on join and map change; in solo mode the client applies the map's profile itself. Changing `sv_*` cvars in the console is allowed only in solo mode, and marks runs as unofficial.

## Player hull and view

| | Standing | Crouched |
| --- | --- | --- |
| Hull (w × d × h) | 32 × 32 × 72 | 32 × 32 × 54 |
| Eye height | 64 | 46 |

## Input

- Mouse yaw/pitch = raw mouse delta × `sensitivity` × `m_yaw` (0.022) / `m_pitch` (0.022), degrees. CS sensitivity values carry over 1:1.
- Pitch clamped to ±89°.
- Movement keys build `forwardmove` and `sidemove` at ±450, then clamped to `sv_maxspeed`.
- Key changes are subtick events (see above); the mouse delta is applied once per frame and the tick uses the view angle at tick time.

## Loop and determinism

- Physics runs in a fixed-step loop (64 Hz) with an accumulator; it never uses frame time.
- The renderer interpolates the camera between the last two ticks, so feel is the same at 60 and 240 FPS.
- At most 8 ticks run per frame; beyond that the simulation slows down instead of spiralling.
- Online, the client sends its state every tick (64 Hz).

## Approximations (CS2 is closed source)

- **Subtick friction stash**: CS2 stashes a speed so split ticks do not compound friction; the exact rule is unknown. Here the first ground friction of a tick stashes the 2D speed and every piece takes `max(stash, stopspeed) × friction × dt` from the current speed, so a split tick loses exactly what an unsplit one does.
- **Landing penalty and duck constants** come from [S8]'s fitted values (medium confidence), checked against [S2]'s in-game measurements (275 → ~185 u/s on a missed flat bhop, next jump ~88%).
- **Duck slowdown in the air**: [S8] scales the wish speed by the duck amount everywhere; here only on the ground (as in Source), because a 3× weaker air strafe while crouched is not what CS2 surfers see.
- **Legacy jump impulse**: the CS2 legacy path is not public; it uses the same impulse as the modern jump, without penalty or window.
- **Stamina** is not simulated (both profiles have jump and land costs 0).
- **Not modelled**: CS2's extra engine-inserted subtick splits (landing, grenades), `sv_jump_precision_enable`, walking (shift), weapon speeds, ladders, water, CS2's own collision margins (Source `DIST_EPSILON` traces are kept), and CS2's ground snap tolerances beyond the 2-unit probe.

## Collision

No physics engine. Maps are built from convex brushes, the same model as Source BSP.

- **Brush:** a convex solid stored as a set of planes (`normal`, `dist`). Boxes, wedges (surf ramps), and arbitrary convex prisms are all brushes.
- **Trace:** sweep the player AABB from start to end against each candidate brush, using the Source `CM_ClipBoxToBrush` method. Each plane is offset by the box's extents projected onto its normal; find the latest entry and earliest exit fraction. Returns `fraction`, `endpos`, `plane`, `startsolid`, `allsolid`.
- **Epsilon:** `DIST_EPSILON = 0.03125`, as in Source, so the player stops just short of surfaces and never sinks in.
- **Broadphase:** a uniform grid (256-unit cells) of brush bounding boxes, built at map load. A trace only tests brushes in the cells its swept box touches.
- **Triggers:** zones and teleports are non-solid AABB or convex volumes tested for overlap each tick.
- **Player vs player:** no collision.

Implementation notes: edge bevels are kept down to a normal length of 1e-4 (Source drops those under 0.5, which made sweeps hit slightly early), and the clip test treats near-parallel motion within 1e-7 as not entering a plane, so sliding inside the epsilon band of a single ramp face never stops the player.

Map spawns and respawns sit 0.25 units above the floor (`SPAWN_CLEARANCE`), because a hull exactly touching a floor counts as solid in the box trace.

Known Source quirk: the "ramp bug" (losing all speed on a seam between two ramp brushes). Source has it because of float precision on brush seams. We avoid it by authoring each ramp as a single brush. No artificial fix is needed.

## Verification tests (vitest)

Measured values from `gamemovement.test.ts` (64 tick):

| Test | Result |
| --- | --- |
| Run forward on flat ground (accel 6.5, friction 5.2) | 25.4 u/s after one tick, 229 after 0.25 s, 250 after 2 s, never above 250; stops from 250 in 26 ticks |
| Standing jump apex | 55.83 units (legacy and modern), 47 air ticks, lands at ~295 u/s |
| Crouch jump (duck in the air) | 64.83 = standing + 9; jump while ducked 57.0 |
| Air strafe at right angles, 1 s, `sv_airaccelerate 150` | Strictly increasing, 346.6 u/s (= sqrt(250² + 64 × 30²)) |
| Deadstrafe | Air accel ×0.25 at vz 100, ×1 at vz 300 and falling; ×1 while rising along a 60° ramp |
| Slide down a 46° / 60° ramp, no input | Stays on the ramp, never grounded, 575 / 693 u/s after 1 s |
| Hold into a 60° ramp from 1000 u/s, 2 s | Stays surfing, 1721 u/s |
| Hit a ramp from above at speed | Velocity clipped along the plane; no stop |
| Modern jump + autobhop (bhop cvars), 10 hops, perfect strafes | No horizontal speed loss on any tick; 638 u/s at the 9th landing; hops ~44 units (landing penalty) |
| Legacy jump + autobhop (surf cvars), 10 hops | No speed loss; hops 55.86 units |
| Missed bhop at 275 u/s (modern) | First ground tick clamps to 180.8 u/s (250 × pen²); a press 0.1 tick after landing restores 275 |
| Jump 2 ticks after a 120-unit drop (modern) | Apex 35.7, vs 55.8 after 1 s |
| Spam penalty | A press exactly 1 tick after the previous is ignored; 1 + 1/64 tick passes |
| `sv_enablebunnyhopping 0` | Jump speed capped at 286 |
| Subtick | Change at when 0 = change at tick start; a key at when 0.5 accelerates half a tick; wheel jump works; split ticks do not compound friction |
| Duck | Hull switch after 13 ticks (203 ms); ducked speed 85; no unduck under a ceiling; eye back to 64 after 12 ticks; spamming drops duck speed below 1.5 |
| 18 / 19-unit step | Steps up / blocks |
| Crease between two ramps, wall corner | Slides along the crease; stops in a 90° corner |
| Velocity clamp | 9876 per axis (surf), 16384 hard limit (bhop's 99999) |
| 60 vs 240 FPS, same input log | Identical tick-by-tick positions (also with the client sampler at 60/144/240 FPS) |
