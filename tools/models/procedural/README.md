# Script-built weapon models

First-person gun models modelled by hand in code with Blender, instead of
generated from a picture (the other first-person files, `tools/models/build.sh`).
`common.py` holds everything the guns share; each gun is one short script that
only describes its parts. The parts that move in a reload are nodes of their own
("Moving parts" below), and the gloved hands that hold the guns are built here
too ("Hands"). The result ships like a generated model: one GLB per
weapon id in `apps/web/static/models/weapons/`, placed by its fit data in
`apps/web/src/lib/render/weapon-assets.ts`.

| Weapon id | Gun | Script | Shipped file | Budget | State |
| --- | --- | --- | --- | --- | --- |
| `striker` | auto shotgun | `shotgun.py` | `striker-fp.glb` | plain | script-built |
| `pistol` | pistol | `pistol.py` | `pistol-fp.glb` | plain | script-built |
| `smg` | submachine gun | `smg.py` | `smg-fp.glb` | plain | script-built |
| `lmg` | light machine gun | `lmg.py` | `lmg-fp.glb` | plain | script-built |
| `sniper` | sniper rifle | `sniper.py` | `sniper-fp.glb` | plain | script-built |
| `barrett` | .50 cal rifle | `heavy_rifle.py` | `barrett-fp.glb` | detailed | script-built |
| `hands` | gloved hands and forearms (every weapon) | `hands.py` | `hands-fp.glb` | own (`HANDS_BUDGET`) | script-built |

Keep the row of a gun up to date (script, budget, state). The budget
column is the current tier; a gun may change tier with its fit data.

Names: no game, franchise or brand names and no gun maker or model names
anywhere here (code, comments, docs, file and texture names). Describe parts by
what they are ("drum magazine", "ghost ring"). Two weapon ids, `striker` and
`barrett`, happen to be names: use them only as ids (the `ID = '...'` line,
the fit data key, the file name the game loads), and name the script and the
mesh for what the gun is, as `shotgun.py` and `'shotgun'` are.
`render/weapon-assets.test.ts` scans every file in this folder for a list of
such names.

## Build

Blender 5.3 and Node (npx fetches the glTF Transform CLI). Blender only runs headless.

```sh
tools/models/procedural/build.sh                          # every script-built gun
tools/models/procedural/build.sh striker                  # one (or several) by weapon id
tools/models/procedural/build.sh striker --renders <dir>  # and neutral renders in <dir>/striker/
BLENDER=/path/to/blender tools/models/procedural/build.sh  # another Blender
```

A gun script is any `.py` file here with a line `ID = '<weapon id>'`;
`build.sh` finds it by that line, so adding a gun needs no edit to `build.sh`.
Blender (`-b --factory-startup`) runs the script, which builds, bakes and writes
`<id>-fp.glb`; glTF Transform then compresses it (meshopt geometry, WebP
textures) without simplifying. The build fails when a gun is over its triangle
or byte budget. It prints, per gun:

```
BUDGET plain 12000 tris 300000 bytes 1024 px
SLIVERS 80                       thin triangles removed (see Pitfalls)
TRIS 11498 of 12000
PIECES shotgun 8694 bolt 260 trigger 68 mag 2476    triangles of the body and of each moving part
BAKE color 2048 115.3 s          ... one line per bake; the last two are the bake with the parts moved apart
LENGTH 40.77 front -0.0          model length; the muzzle must be the front (0)
FIT striker: { grip: [...], fore: [...], sight: [...], front: [...], fp: { len: 40.77, at: [0, 0.8, -25.32] } }
NODES bolt trigger mag eject magwell grip_mag grip_bolt hand_r hand_l   checked again in the compressed file
WEBP 80 80 80: 279996 bytes      quality of base colour, normal, roughness: the highest of four that fits the byte budget
.../striker-fp.glb: 279996 of 300000 bytes (plain), built in 285 s
```

Plain tier (2048 px bakes): the shotgun builds in about 5 minutes on 8 CPU cores
(the colour bake is half of it). Detailed tier (4096 px bakes): the
same mesh bakes in about 13 minutes, so iterate with `bake=2048` (no
supersampling) or `bake=1024` and bake at full size only for the shipped file.
To iterate on shape, run Blender yourself with a smaller bake and no export
compression:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
  -P tools/models/procedural/shotgun.py -- /tmp/x.glb bake=1024 renders=/tmp/renders
```

Options after `--`: the output path, then `bake=<px>` (bake size; below the texture size the textures shrink with it),
`parts=1` (the heaviest parts), `overlap=1` (texels that two triangles share: a few hundred are bevel corners, more is a part that folds over itself in its island),
`renders=<dir>` (neutral renders), `budget=detailed` (try the other tier),
`mask=edge|grime|vary` (bake one wear mask as the base colour, to check it).

## Building on another machine

Builds and bakes are heavy and need no display, so they also run on a headless
Linux machine (checked with Blender 5.2.2 on Linux and 5.3 on macOS): `common.py`
works on both; don't use calls that only 5.3 has. `build.sh` takes Blender from
the PATH before the macOS app. Without a GPU the renders use Cycles on the CPU.
Write renders inside the checkout and move them out before committing.

```sh
tools/models/procedural/build.sh pistol --renders out-pistol/renders
```

## Spaces

**Model space** is the space of the gun's code-built model
(`apps/web/src/lib/render/viewmodels.ts`): three.js axes, +X right, +Y up, the
bore along -Z, in that model's units. Build the gun in those units with the bore
where the code-built bore is (its `bore_y` and muzzle `z`), so the hands, the
muzzle flash and the hip pose line up without new numbers. Every helper takes
model-space points; `G(x, y, z)` turns one into Blender's axes when you need
raw bmesh coordinates.

**Asset space** is what the GLB holds (`weapon-assets.ts`): the muzzle centre
at the origin, the bore along -Z, length 1 from the muzzle to the back of the
model. `finish()` moves and scales the mesh there. The muzzle has to be the
frontmost point of the model (`LENGTH ... front 0`), or the scale is off.

## Writing a gun

```python
"""Pistol, first-person model: build.sh pistol (README.md in this folder)."""
import os, sys, math
sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

# The shapes and numbers below only illustrate the calls.
ID = 'pistol'
BORE_Y, MUZZLE_Z = 2.05, -8.87   # the code-built bore and muzzle (fp.at of the gun)

start(ID, 'pistol', BORE_Y, MUZZLE_Z)
slide = section('slide', 'steel', [(-0.6, 1.5), (0.6, 1.5), (0.6, 2.6), (-0.6, 2.6)], -8.8, 3.2)
part(slide, 0.05)
...
finish(fit=dict(grip=(0, -1.8, 1.4), fore=None, sight=(0, 2.95, 2.9), front=(0, 2.95, -8.0)), budget='plain', wear=1.0)
```

`start(id, name, bore_y, muzzle_z, surfaces=None)` empties the scene and makes
the materials. `finish(fit, budget='plain', wear=1.0)` joins every `part()`
into one mesh, unwraps it, removes slivers, checks the triangle budget, bakes,
exports and prints `FIT`. `fit` holds model-space points: `grip` (middle of
the grip, where the right hand closes), `fore` (under the fore-end where the
left hand cradles it, or `None` for one hand), `sight` and `front` (rear and
front point of the sight line, or `None`).

### Helpers

Shapes; `mat` is a surface name (below) or `None` for a cutter:

| Helper | Example |
| --- | --- |
| `box(name, mat, centre, size, rot=None)` | `box('catch', 'steel', (0, -1.95, -1.45), (1.3, 0.36, 0.42))`; `rot=('x', 0.6)` turns it about its centre |
| `rod(name, mat, p0, p1, r0, r1=None, seg=24)` | `rod('pin', 'bright', (-1.7, -0.65, 1), (1.7, -0.65, 1), 0.16, seg=8)`: cylinder, or cone with `r1` |
| `side(name, mat, [(z, y), ...], x0, x1)` | side profile pushed across X: receivers, grips, stocks, triggers |
| `section(name, mat, [(x, y), ...], z0, z1)` | cross-section pushed along the bore: rails, handguards, slides |
| `extrude(name, mat, blender_pts, step)` | any flat polygon (Blender points, use `G()`) pushed along a vector |
| `lathe(name, mat, [(r, t), ...], centre, 'z', seg=32, closed=False)` | profile (`r` from the axis, `t` along it) turned about the `'x'` or `'z'` axis: muzzles, scope tubes, drums, knobs |
| `ring(name, mat, centre, 'z', r_out, r_in, length)` | tube or washer, the hole cut: ring sights, scope rings |
| `torus(name, mat, centre, 'z', R, r)` | round loop: sling swivels |
| `screw(name, p0, p1, r)` | slotted screw head from `p0` (in the part) to `p1` (proud of it) |

Booleans, bevels and normals:

| Helper | Example |
| --- | --- |
| `cut(o, cutters, dark=False, mat=None)` | `mat='inner'`: the cut faces take that surface (wells, raceways, trays). `cut(upper, [box('port', None, (1.75, 1, -3), (1.3, 0.85, 3))], dark=True)`: difference; `dark` gives the cut faces the dark material (bores, ports, slots) |
| `part(o, w=None, seg=2, angle=30)` | `part(grip, 0.14, 2)`: bevel the hard edges (width `w`, hardened normals) and add it to the gun; without `w`, smooth shading split at `angle` |
| `bevel(o, w, seg=2, angle=30)` | bevel without adding: the first step of bevel, cut, `fix` |
| `fix(o, angle=50)` | after cuts into a bevelled part: sharp edges over `angle`, weighted normals, add it to the gun |
| `join(objs)`, `apply(o)`, `tris(o)` | join objects, apply a modifier stack, count triangles |

Two ways to combine cuts and bevels:

```python
# A few large openings: cut, then bevel (the cut edges get rounded too).
cut(upper, [box('port', None, (1.75, 1.0, -3.0), (1.3, 0.85, 3.0))], dark=True)
part(upper, 0.07)

# Many small or close cuts (rail slots, vent holes): bevel first, then cut, then fix.
rail = section('rail', 'steel', profile, -7.4, 3.3)
bevel(rail, 0.03, 1)
cut(rail, [box('rs%d' % i, None, (0, 2.5, -6.6 + i * 0.7), (2.0, 0.4, 0.3)) for i in range(13)])
fix(rail)
```

### Moving parts

```python
with moving('mag', (0, -1.6, -3.45)):        # name and pivot (model space)
	mag = side('magazine', 'steel', ...)
	part(mag, 0.06)                          # every part() and fix() in here belongs to it
point('magwell', (0, -1.6, -3.45))           # an empty node: place, XYZ turn
point('grip_mag', (0, -3.52, -3.45), under='mag')   # travels with the part
```

- In the file a moving part is a node with that name at its pivot (hinge, pin,
  seat, bolt axis), its mesh a child of it: the compression moves the origin of
  a mesh node, not of its parent. All parts share the material and the textures.
- Names and travel are in `apps/web/src/lib/render/gun-rig.ts` (`GUN_PARTS`): `slide`,
  `bolt`, `mag`, `cover`, `belt`, `trigger`. Every gun has the points `eject` (+X is
  the way a case leaves), `magwell` (the seat; −Y is the way out), `grip_mag` and
  `grip_bolt` (where a hand takes hold; under their part), `hand_r` and `hand_l` (grip and fore-end).
- The bake sees the whole gun at rest, so a gun in parts looks like one without.
  What a part hides at rest (a magazine in its well, the well) would bake black:
  those texels come from a second bake with the parts moved apart.
- Model what shows when a part moves: the well and the rounds in the magazine, the
  chamber and the raceway, the tray under a cover. A part must not poke out of the one it moves through (the
  pistol's hood is chamfered to stay inside the slide).
- A part is one draw call; a gun has at most 8 (`gun-rig.test.ts`).
- A slot has to be as long as the travel of the handle in it.
- A magazine may be at most 0.10 in the gun anywhere on its track, seated too, and so may the gun in it
  (`fp-contact.test.ts`): no pin through a well, no mount inside the rim of a box. The measuring fills the
  holes of a mesh (the pyramids of a stippled grip have no base), so they need not be closed.
- The rounds of the LMG's belt move one by one along the places in `BELT_WAY` (`render/gun-rig.ts`): keep it in
  step with `RND` in `lmg.py`, and the box open under its mouth for the next round.

### Surfaces

One material per surface during the build; the bake folds them into one texture
set. `SURF` in `common.py` has `steel` (blued or parkerised parts), `bright`
(pins, screws, triggers), `polymer` (furniture), `rubber` (grip panels, butt
pads), `dark` (insides of bores and ports), `inner` (machined insides that show when a part moves) and `brass`
(cartridges; `cartridge(name, base, length, r)` makes one along the bore). Each entry has base and worn
colour (sRGB), metalness and roughness, worn metalness and roughness, `amount`
(how much its edges wear) and `kind` (`metal`, `polymer`, `rubber`, `none`:
how the wear pass treats it). Add or change one per gun:

```python
start(ID, 'shotgun', BORE_Y, MUZZLE_Z, surfaces={
	'drum': dict(SURF['polymer'], base=(0.21, 0.21, 0.205), rough=0.58),
})
```

## The bake and the wear pass

Cycles bakes, at twice the texture size and then averaged down:

- **base colour**: each surface's colour with the wear pass, times ambient
  occlusion (75 %), so the shape reads under the flat viewmodel light;
- **normal map**: rounded edges from a bevel shader (radius 0.035), so the
  hard edges catch light without more geometry;
- **roughness and metalness** (half size): with the same wear pass.

The wear pass, in `bake_nodes()`, is three masks, each tuned on the shotgun:

- **edge**: convex edges (a rounded normal leaves the true one, and occlusion
  within 0.3 units is open, which keeps inside corners out), broken up by
  noise, turn towards the surface's worn colour, roughness and metalness:
  lighter, smoother metal; a polished sheen on polymer; little on rubber;
- **grime**: concave areas (occlusion within 0.6 units), patchy, turn darker
  and rougher;
- **vary**: soft noise a few units across moves tone and roughness by
  10 to 15 %, so flat panels aren't uniform.

No rust, blood or decals: keep it subtle. `finish(wear=0.6)` scales all three,
`finish(wear=dict(edge=1.2, grime=0.8, vary=1.0))` each on its own (add `radius=` for the width of the worn edge band, default 0.07 model units, or `width=` as a factor on it: a wider band reads from the hip on a small or long gun), `wear=0`
leaves the gun clean. `KIND` and `GRIME` in `common.py` hold the per-kind
amounts and the grime colour. To see a mask alone, bake with `mask=edge`
(or `grime`, `vary`) and `renders=<dir>`; the base colour is then the mask.

Noise and grain cost WebP bytes. The masks are low-frequency and baked with
enough samples to come out smooth; keep them that way when tuning.

## Hands

`hands.py` builds one right hand with its forearm (`build.sh hands`); the game mirrors it for the left one
(`render/hands.ts`). It is one skinned mesh of 17 bones (hand, forearm, three per finger and thumb):
a pair costs two draw calls where 34 rigid segments would cost 34, and the knuckles bend
without gaps. Every bone is bound without a turn, so a pose is a few angles about the
axes of the hand: the wrist at the origin, the fingers along −Z, the palm facing −Y, the thumb on
−X (right hand). three.js can skin on the CPU, so the node tests measure the real skin.
Its colours are those of the code-built hands; cloth gets a bump (leather grain, weave, creases) on top of the wear pass.

The poses (`render/hand-pose-data.ts`) are solved, not drawn: `fit_hands.mjs` starts each from a seed
(how the palm faces, which point of the hand lies where, what has to touch) and
searches for the wrist and the finger bends that touch the gun without sinking in.
Run it after a change to a grip, a fore-end, a magazine, a handle or the hands, then the tests:

```sh
node --no-warnings --experimental-transform-types tools/models/procedural/fit_hands.mjs          # every pose: the ones that ride a part are slow
  # ... fit_hands.mjs sniper lmg --only grip,bolt                                                     # some
  # ... fit_hands.mjs lmg.bolt pistol.grip                                                            # these
```

A pose that rides a moving part (`part` and `states` in its seed: a bolt knob, a handle, the slide, the feed cover) is
solved against the gun with the part at each of those places, and has to touch the part itself; `around` puts the
thumb across from the fingers, `pads` the pads of fingers on their places, `alts` tries several ways to come to it and keeps
the best (`ALTS=1` prints them). Such a pose takes ten to fifteen minutes, a plain one one to three. The pistol's left-hand poses keep clear of its right
hand as it is in the data file: solve `pistol.grip` first, in a run of its own.

It samples the skin at 0.12 units, faces included (a thin edge passes between two
vertices). `TRY='{"turn": 0.9}'` tries other numbers for the grips of one run.
It prints, per pose, the deepest point, the gap of each fingertip and of the palm, the
forearm and the bend of the wrist. `hand-contact.test.ts` holds the limits (model units, about
2.3 cm): fingers and palm at most 0.10 deep, fingertips and palm at most 0.15 away, forearm at
most 0.10 in the gun; on a knob, a handle, the slide and the cover thumb, index and middle finger within 0.10 of that part
wherever it has gone, the palm within 0.70 of a knob. `/?mockvm&weapon=smg&hand=mag&view=side&close=1` shows a pose close up.

## Budgets

`MODEL_BUDGET` in `weapon-assets.ts`, checked by `render/weapon-assets.test.ts`
on the shipped file:

| Tier | Triangles | Bytes | Textures |
| --- | --- | --- | --- |
| `plain` | at most 12,000 | 300,000 | 1024 px base colour and normal, 512 px roughness/metalness |
| `detailed` | more than 12,000, at most 30,000 | 700,000 | 2048 px and 1024 px |

A `detailed` gun sets `detailed: true` in its fit data and must have more than
12,000 triangles (the test checks both ways). Geometry is about half of a plain
file: the shotgun's 11,800 triangles are about 130 KB, its three textures about
150 KB.

## Wiring a gun into the game

1. Build it: `build.sh <id>`. The file lands in `apps/web/static/models/weapons/<id>-fp.glb`.
2. In `GENERATED` in `apps/web/src/lib/render/weapon-assets.ts`, set the gun's
   entry from the `FIT` line: `grip`, `fore`, `sight`, `front` (asset space),
   `fp.len` (the model length in model units) and `fp.at` (where the muzzle
   goes: on the code-built bore, at the code-built muzzle).
3. Choose the rest:
   - `rake`: how far the grip leans back from vertical (rad);
   - `fp.grip`: half width and depth of the grip in the right hand;
   - `fp.fore`: half width of the fore-end and how far the left fingers reach up it (`[0, 0]` one-handed);
   - `fp.aim`: how far ahead of the eye the sight point sits fully aimed
     (viewmodel camera units): far enough that the rear sight frames the front
     one, near enough that the gun doesn't shrink to nothing;
   - `detailed: true` for the detailed tier; `dot: true` for an optic with
     its glass cut open (a red dot at `front` is the aim mark);
     `shade` only for a model whose base colour is much lighter than the others.
4. Write a comment above the entry: how the hands hold it and what the sight line runs through.
5. Update your gun's row in the table at the top of this file, and replace your
   gun's row in the "Models" table of `CREDITS.md` (each gun has one already; copy
   the shotgun's wording). Check that the shared prose is still true: the
   `CREDITS.md` paragraph above that table, `docs/modes.md` and the header
   comment of `weapon-assets.ts`.
6. `pnpm test`. The tests load the shipped file. What they check, in asset space:
   - `weapon-assets.test.ts`: the byte and triangle budget, the muzzle at the
     origin and length 1; more than 10 vertices within 0.1 of `grip`, within 0.05
     of `fore`, and within 0.06 of a point 0.03 below `sight`; the grip's
     vertices at the height of `grip` centred on `x = 0` (within 0.02); `sight`
     above `grip` and above the bore, more than 0.3 behind the muzzle, `|x| < 0.02`;
     the hands on grip and fore-end, the muzzle on the tracer line;
   - `infected-aim-pose.test.ts`: `front` ahead of `sight` and not ahead of the
     muzzle, `fp.aim > 1`; fully aimed, both on the view axis at `fp.aim`; no
     near-plane cut and the forearms off screen on the way in and out; and, for
     every gun but the scoped rifles (sniper, .50 cal: the client hides them
     once fully aimed), nothing of the gun above the sights, the hands below
     them, and an open notch above the front post or, with `dot: true`, an open
     middle of the optic;
   - `infected-viewmodels.test.ts`: at rest and while kicking the model is in
     view, low and to the side, with the screen centre clear; fully lowered it is
     out of view.

## Screenshots, headless

The dev viewer (`/?mockvm`) draws the viewmodel without the game. Run a Vite
dev server on port 6573 and `shots.mjs` with Playwright's headless Chromium;
nothing opens on screen, and the page can't reach any other host or port:

```sh
pnpm --filter web exec vite dev --port 6573 --strictPort &      # stop it when done
mkdir -p /tmp/pw && (cd /tmp/pw && npm i playwright-core)       # outside the workspace: no new dependency
PLAYWRIGHT=/tmp/pw CHROMIUM=<path to chrome-headless-shell> \
  node tools/models/procedural/shots.mjs striker /tmp/shots
```

It writes `<id>-rest-light.png`, `-rest-dark`, `-aim-light`, `-aim-dark` and
`-side-light` at 1920x1080, each once the viewer's label says it drew the
`generated` model (`code-built` in the label means the file didn't load).
`CHROMIUM` can be any Chromium binary, e.g. Playwright's cached
`chrome-headless-shell` under `~/Library/Caches/ms-playwright/`. More views:
`&view=side|right|front|top|iso|rear`, `&pose=rest|kick|draw|reload|aim` with
`&t=0..1`, `&bg=sky|dark|light`, `&gen=0` for the code-built model,
`&sheet=poses|views|aim` (`render/viewmodel-viewer.ts` has the list).

Neutral Blender renders (Cycles on the CPU, grey, side and three-quarter views
framed on the model): `build.sh <id> --renders <dir>`. They use Cycles because
Eevee crashes on a server without a GPU.

## Pitfalls (from the shotgun)

- **Slivers.** Boolean and bevel seams leave triangles thinner than the 16-bit
  quantisation of the shipped file (about 1/32000 of the length). Quantised,
  such a triangle becomes a line, and a test that samples the screen reads it
  as covering every point on that line (a "blocked" screen centre with nothing
  visible). `finish()` removes every triangle thinner than length / 20800 and
  prints how many (`SLIVERS`); dozens are normal.
- **Bevels after booleans.** A bevel modifier on a part with many small cuts
  overlaps itself and wrecks the shading. Bevel the blank first, cut, then
  `fix()` (weighted normals keep the big faces flat while the bevels turn the
  light). Cut-then-`part(o, w)` is fine for a few large openings.
- **Empty material slots.** A cut without `dark=True` can leave an empty slot;
  `finish()` fills it with the part's own material.
- **Open sights and optics for the aim tests.** Fully aimed, the view above the
  sights and the middle of the screen must be clear (all guns but the scoped
  rifles). A ghost ring or notch needs a real opening above the front post. A
  gun aimed through an optic it doesn't zoom with (the light machine gun) needs
  the tube open end to end (no glass, no lens caps, no reticle mesh), `dot: true`
  and `front` in the middle of the objective. The scoped rifles skip that check,
  but their scope axis is still the sight line, and nothing may cut the near
  plane on the way in. A rear aperture that is too small closes over the front
  post at the aim depth: widen it or change `fp.aim`.
- **The muzzle is the front.** Nothing (bayonet lug, sight hood, brake) may
  stand ahead of the muzzle centre, or asset space is scaled wrong and the
  muzzle test fails.
- **Fit points near the model.** The tests count vertices around `grip`, `fore`
  and just below `sight` (radii in step 6 of "Wiring"). The sight point of a
  ring or notch floats in the opening, so the ring or the notch's floor must be
  within reach below it; a coarse part (a cylinder with few segments) can have
  too few vertices near the point even when it is there.
- **Changing the length moves the fit data.** Asset space is normalised to
  length 1, so a longer or shorter stock changes every asset-space number. Copy
  the `FIT` line again after any change to the ends of the gun.
- **Islands.** Each part is unwrapped on its own: over the whole gun
  `smart_project` shares its projection directions, and a part that suits none of
  them folds over itself (dark blotches in the bake, on parts you didn't touch).
- **Thin legs.** A bevel wider than the part it runs round turns faces over.
  Bevel first, then cut, then `fix()`.
- **Bytes.** Wear detail, fine noise and grainy bakes all cost WebP bytes.
  Check the size line of `build.sh` after every look change.
- **`__pycache__`.** Keep `sys.dont_write_bytecode = True` above the
  `common` import, or Blender leaves a cache folder here.
