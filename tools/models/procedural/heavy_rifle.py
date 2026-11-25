"""
Heavy semi-automatic anti-materiel rifle, first-person model: build.sh barrett
(README.md in this folder).

Built in the model units of the code-built .50 cal rifle
(apps/web/src/lib/render/viewmodels.ts, heavyRifle): the bore along -Z on
y = 0.3, the muzzle at z = -36.37, the grip and fore-end where its hands hold
them (grip(4.0, -1.8), underForeEnd(-14.8, -1.6)), the scope on y = 4.5 with
its eyepiece at z = 5.71. The bolt moves with the charging handle, the box
magazine drops out along its rake, the trigger turns; the chamber in the port,
the magazine well and the top round show then. common.py does the rest: one
texture set, the GLB in asset space.
"""
import os, sys, math
sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

ID = 'barrett'

# Layout of the code-built model (model units).
BORE_Y = 0.3
MUZZLE_Z = -36.37
SCOPE_Y = 4.5      # scope axis: the sight line
EYE_Z = 5.71       # rear face of the eyecup
OBJ_Z = -13.27     # front face of the objective bell
RING_Z = (-6.4, 0.0)
BUTT_Z = 17.45     # back of the recoil pad
CH_Z = 0.3         # charging handle at rest
TRAVEL = 3.4       # how far it goes back (render/gun-rig.ts)
MAG_RAKE = 0.075   # the magazine leans back

start(ID, 'heavy-rifle', BORE_Y, MUZZLE_Z, surfaces={
	# Parkerised steel: darker and flatter than the shotgun's.
	'steel': dict(SURF['steel'], base=(0.33, 0.335, 0.34), metal=0.55, rough=0.5, wear=(0.74, 0.75, 0.76), wmetal=0.95, wrough=0.24),
	'polymer': dict(SURF['polymer'], base=(0.185, 0.188, 0.192), rough=0.62, wear=(0.47, 0.475, 0.48), amount=1.0),
	# Recoil pad and grip panels: rubber, its edges rubbed a little lighter so they read from the hip.
	'rubber': dict(SURF['rubber'], wear=(0.38, 0.385, 0.39), amount=1.0),
	# Anodised optic housing: near black, a little sheen; edges wear to bare aluminium.
	'optic': dict(SURF['steel'], base=(0.17, 0.175, 0.18), metal=0.5, rough=0.4, wear=(0.66, 0.67, 0.69), wmetal=0.9, wrough=0.28, amount=0.8),
})

def S(lst):
	return [(s, x) for s in (-1, 1) for x in lst]

# ---------------------------------------------------------------------
# Upper receiver: one long steel box from the butt joint over the rear of the
# barrel, chamfered along the top, the rear sloping down to the stock. Ejection
# port and charging-handle slot on the right, lightening slots in the front
# (barrel shroud) part, a groove along each side.

upper = side('upper', 'steel', [(-19.0, -0.05), (8.0, -0.05), (8.0, 1.3), (7.0, 2.1), (-19.0, 2.1)], -1.45, 1.45)
cut(upper, [box('chamfer', None, (s * 1.45, 2.1, -5.5), (0.62, 0.62, 30.0), ('z', math.pi / 4)) for s in (-1, 1)])
bevel(upper, 0.06, 2)
# The slot runs back far enough for the whole travel of the handle.
cuts = [box('port', None, (1.2, 1.05, -2.8), (1.74, 0.9, 3.6)),
	box('ch-slot', None, (1.6, 1.32, (-0.3 + CH_Z + TRAVEL + 0.2) / 2), (0.7, 0.32, CH_Z + TRAVEL + 0.2 + 0.3))]
for z in (-12.4, -14.0, -15.6, -17.2):
	for s in (-1, 1):
		cuts.append(box('vent', None, (s * 1.55, 1.2, z), (0.6, 0.6, 1.15)))
		cuts.append(rod('vent-hole', None, (s * 1.25, 0.25, z), (s * 1.8, 0.25, z), 0.2, seg=10))
cut(upper, cuts, dark=True)
cut(upper, [box('side-groove', None, (s * 1.47, 1.62, -3.0), (0.14, 0.14, 19.0)) for s in (-1, 1)])
fix(upper)
# Chamber in the port, uncovered when the bolt goes back: the breech ring and the hole in it.
breech = rod('breech', 'bright', (0.85, 1.05, -4.7), (0.85, 1.05, -4.4), 0.44, seg=16)
cut(breech, [rod('breech-hole', None, (0.85, 1.05, -4.6), (0.85, 1.05, -4.1), 0.3, seg=14)], dark=True)
fix(breech, 40)
with moving('bolt', (0, 1.2, CH_Z)):
	# Bolt face in the port, with the extractor groove.
	bolt = box('bolt', 'bright', (0.9, 1.05, -2.8), (0.9, 0.72, 3.3))
	cut(bolt, [box('groove', None, (1.38, 1.05, -2.8), (0.2, 0.16, 3.5))], dark=True)
	part(bolt, 0.03, 1)
	# Charging handle: stem in the slot and a serrated knob.
	part(rod('ch-stem', 'steel', (1.2, 1.32, 0.3), (2.05, 1.32, 0.3), 0.14, seg=10), 0.02, 1)
	knob = rod('ch-knob', 'steel', (1.85, 1.32, 0.3), (2.55, 1.32, 0.3), 0.36, 0.33, seg=16)
	bevel(knob, 0.05, 1)
	cut(knob, [rod('ch-serr', None, (2.0 + i * 0.13, 0.8, 0.3), (2.0 + i * 0.13, 1.84, 0.3), 0.035, seg=4) for i in range(4)] +
		[rod('ch-serr', None, (2.0 + i * 0.13, 1.32, -0.2), (2.0 + i * 0.13, 1.32, 0.8), 0.035, seg=4) for i in range(4)])
	fix(knob)

# Top rail under the scope: bevelled first, then the cross slots.
RAIL0, RAIL1 = -11.0, 5.6
rail = section('rail', 'steel', [(-0.62, 2.05), (0.62, 2.05), (0.62, 2.25), (0.78, 2.38), (0.78, 2.5), (0.6, 2.64), (-0.6, 2.64), (-0.78, 2.5), (-0.78, 2.38), (-0.62, 2.25)], RAIL0, RAIL1)
bevel(rail, 0.03, 1)
n = int((RAIL1 - RAIL0 - 0.6) / 0.8)
cut(rail, [box('rs', None, (0, 2.56, RAIL0 + 0.6 + i * 0.8), (2.0, 0.4, 0.32)) for i in range(n)])
fix(rail)

# Folding carry handle on the shroud, ahead of the scope: two hinge blocks, the
# loop cut out of a plate, a polymer sleeve on the bar.
for z in (-14.2, -18.4):
	part(box('hinge', 'steel', (0, 2.3, z), (1.1, 0.5, 0.7)), 0.05, 1)
	part(rod('hinge-pin', 'bright', (-0.62, 2.38, z), (0.62, 2.38, z), 0.13, seg=8), 0.015, 1)
handle = side('handle', 'steel', [(-14.0, 2.2), (-18.6, 2.2), (-18.2, 3.45), (-17.6, 3.8), (-15.0, 3.8), (-14.4, 3.45)], -0.32, 0.32)
cut(handle, [side('handle-hole', None, [(-14.65, 2.45), (-17.95, 2.45), (-17.55, 3.3), (-15.05, 3.3)], -1, 1)])
part(handle, 0.07)
grip_sleeve = rod('handle-grip', 'polymer', (0, 3.55, -15.1), (0, 3.55, -17.5), 0.36, seg=14)
bevel(grip_sleeve, 0.04, 1)
cut(grip_sleeve, [rod('hg-rib', None, (0, 3.55, z - 0.06), (0, 3.55, z + 0.06), 0.5, seg=14) for z in (-15.6, -16.3, -17.0)])
fix(grip_sleeve)

# Takedown pins (pull rings on the left) and cross pins.
for z in (-10.9, 7.3):
	part(rod('qd-pin', 'bright', (-1.78, -0.15, z), (1.72, -0.15, z), 0.17, seg=10))
	part(rod('qd-head', 'steel', (-1.62, -0.15, z), (-1.84, -0.15, z), 0.3, seg=14), 0.03, 1)
	part(torus('qd-ring', 'bright', (-1.9, -0.6, z), 'x', 0.36, 0.06, seg=14, sides=6))

# ---------------------------------------------------------------------
# Lower receiver: steel, a little wider than the upper; magazine well, trigger
# guard, safety, magazine catch, pins.

lower = side('lower', 'steel', [(-11.6, 0.2), (8.0, 0.2), (8.0, -1.3), (7.3, -1.8), (-3.7, -1.8), (-4.4, -1.25), (-11.0, -1.25), (-11.6, -0.8)], -1.6, 1.6)
bevel(lower, 0.07, 2)
cut(lower, [box('lower-flat', None, (s * 1.66, -0.65, -7.6), (0.2, 0.7, 5.6)) for s in (-1, 1)])
cut(lower, [box('mag-well', None, (0, -1.4, -0.95), (2.66, 2.6, 4.95), ('x', -MAG_RAKE))], mat='inner')
fix(lower)
for y, z in [(-0.75, -8.9), (-0.9, 5.0), (-0.5, -5.6)]:
	part(rod('pin', 'bright', (-1.66, y, z), (1.66, y, z), 0.15, seg=8, phase=math.pi / 8))
# Magazine well lip.
well = box('well', 'steel', (0, -2.05, -0.95), (2.95, 0.6, 5.5))
cut(well, [box('well-hole', None, (0, -2.05, -0.92), (2.66, 1.4, 4.95), ('x', -MAG_RAKE))], mat='inner')
part(well, 0.08)
# Safety lever on the left above the grip, magazine catch on the right.
part(rod('safety-hub', 'steel', (-1.58, -0.55, 5.9), (-1.8, -0.55, 5.9), 0.36, seg=16), 0.03, 1)
part(box('safety-lever', 'steel', (-1.77, -0.95, 5.45), (0.12, 0.32, 1.2), ('x', -0.65)), 0.03, 1)
part(rod('mag-catch', 'steel', (1.5, -1.25, 1.3), (1.78, -1.25, 1.3), 0.3, seg=14), 0.04, 1)
# Trigger guard: the opening cut out of the solid guard; trigger.
guard = side('guard', 'steel', [(2.0, -1.75), (2.2, -3.3), (4.0, -3.55), (4.8, -3.0), (4.4, -1.75)], -0.4, 0.4)
cut(guard, [side('guard-hole', None, [(2.45, -1.6), (2.62, -2.95), (3.85, -3.15), (4.25, -2.8), (4.05, -1.6)], -1, 1)])
part(guard, 0.06)
with moving('trigger', (0, -1.8, 3.02)):
	part(side('trigger', 'bright', [(2.85, -1.75), (3.2, -1.75), (3.3, -2.4), (3.15, -2.95), (3.0, -2.92), (3.08, -2.4)], -0.16, 0.16), 0.03, 1)

# Pistol grip (right hand) with finger grooves and inset grip panels.
grip = side('grip', 'polymer', [(4.0, -1.8), (4.45, -3.2), (4.35, -3.5), (4.8, -4.65), (4.7, -4.95), (5.2, -6.1), (5.5, -6.45), (8.15, -6.45), (8.2, -6.1), (7.15, -2.7), (7.25, -2.15), (7.65, -1.8)], -1.0, 1.0)
part(grip, 0.14, 2)
for s in (-1, 1):
	part(side('panel', 'rubber', [(4.95, -2.6), (5.65, -5.7), (7.4, -5.7), (6.7, -2.6)], s * 0.9, s * 1.09), 0.035, 2)
	screw('panel-screw', (s * 1.05, -4.15, 6.2), (s * 1.16, -4.15, 6.2), 0.15)

# ---------------------------------------------------------------------
# Box magazine: steel body raked back a little, recessed side panels with a
# stiffening rib between them, witness holes, a heavy base plate.

# (Cutters in one cut() must not overlap each other: the exact solver drops the part.)
SEAT = (0, -2.35, -0.9)
with moving('mag', SEAT):
	mag = side('mag', 'steel', [(-3.38, -0.5), (1.37, -0.5), (1.8, -7.45), (-2.8, -7.45)], -1.28, 1.28)
	bevel(mag, 0.08, 2)
	rake = lambda y: MAG_RAKE * (-1.75 - y)  # the magazine leans back: its middle moves this far aft at height y
	cut(mag, [box('mag-pan', None, (s * 1.36, (y0 + y1) / 2, -1.05 + rake((y0 + y1) / 2)), (0.2, y0 - y1, 3.3)) for s in (-1, 1) for y0, y1 in ((-2.7, -4.3), (-4.8, -6.8))])
	cut(mag, [rod('witness', None, (s * 1.1, y, 1.0 + rake(y)), (s * 1.5, y, 1.0 + rake(y)), 0.13, seg=8) for s in (-1, 1) for y in (-3.0, -4.0, -5.0, -6.0)], dark=True)
	# The mouth with the top round, inside the well.
	cut(mag, [box('mag-mouth', None, (0, -0.7, -1.05), (1.7, 1.0, 4.3))], mat='inner')
	fix(mag)
	cartridge('round', (0.1, -0.72, 1.05), 4.1, 0.4, seg=12)
	plate = side('mag-plate', 'polymer', [(-3.05, -7.3), (2.0, -7.3), (2.1, -7.7), (1.9, -8.05), (-2.95, -8.05), (-3.15, -7.7)], -1.42, 1.42)
	part(plate, 0.08)

# ---------------------------------------------------------------------
# Handguard under the shroud (left hand), vent slots, finger grooves, the
# steel front plate, the barrel bushing, the front sling point.

hg = section('handguard', 'polymer', [(-1.5, 0.1), (-1.5, -0.9), (-1.15, -1.45), (-0.55, -1.6), (0.55, -1.6), (1.15, -1.45), (1.5, -0.9), (1.5, 0.1)], -11.6, -18.7)
bevel(hg, 0.07, 1)
slots = [box('hg-vent', None, (s * 1.6, -0.55, z), (0.6, 0.34, 1.2)) for s in (-1, 1) for z in (-12.6, -14.2, -15.8, -17.4)]
cut(hg, slots, dark=True)
cut(hg, [box('hg-ridge', None, (0, -1.67, z), (3.4, 0.28, 0.3)) for z in (-13.0, -14.8, -16.6)])
fix(hg)
front_plate = section('front-plate', 'steel', [(-1.55, -0.9), (-1.2, -1.5), (-0.6, -1.66), (0.6, -1.66), (1.2, -1.5), (1.55, -0.9), (1.55, 1.75), (1.15, 2.16), (-1.15, 2.16), (-1.55, 1.75)], -18.7, -19.15)
part(front_plate, 0.05, 1)
for s in (-1, 1):
	for z in (-12.0, -18.2):
		screw('hg-screw', (s * 1.46, -0.85, z), (s * 1.58, -0.85, z), 0.14)
bush = rod('bushing', 'steel', (0, BORE_Y, -19.0), (0, BORE_Y, -19.75), 1.32, 1.28, seg=28)
bevel(bush, 0.05, 1)
cut(bush, [box('spanner', None, (math.cos(a) * 1.3, BORE_Y + math.sin(a) * 1.3, -19.5), (0.34, 0.34, 0.6)) for a in (0, math.pi / 2, math.pi, 1.5 * math.pi)], dark=True)
fix(bush)
part(box('swivel-base', 'steel', (-1.62, -1.0, -17.9), (0.3, 0.45, 0.5)), 0.03, 1)
part(torus('swivel', 'bright', (-1.86, -1.55, -17.9), 'z', 0.42, 0.08, seg=16, sides=6))

# ---------------------------------------------------------------------
# Barrel: heavy, tapering, six rounded flutes; lock nut and the arrowhead
# muzzle brake (two side chambers, the bore through the nose).

BR0, BR1, BZ0, BZ1 = 1.02, 0.9, -19.6, -32.2
barrel = rod('barrel', 'steel', (0, BORE_Y, BZ0), (0, BORE_Y, BZ1), BR0, BR1, seg=36)
flutes = []
for i in range(6):
	a = math.pi / 6 + i * math.pi / 3
	c, s = math.cos(a), math.sin(a)
	z0, z1 = -21.0, -30.4
	r0 = BR0 + (BR1 - BR0) * (z0 - BZ0) / (BZ1 - BZ0) + 0.1
	r1 = BR0 + (BR1 - BR0) * (z1 - BZ0) / (BZ1 - BZ0) + 0.1
	flutes.append(rod('flute', None, (c * r0, BORE_Y + s * r0, z0), (c * r1, BORE_Y + s * r1, z1), 0.24, seg=10))
cut(barrel, flutes)
fix(barrel, 40)
nut = rod('brake-nut', 'steel', (0, BORE_Y, -31.75), (0, BORE_Y, -32.35), 1.12, seg=6, phase=math.pi / 6)
part(nut, 0.05, 1)

def brake_outline(y):
	pts = [(-1.05, -32.25), (-1.7, -32.55), (-1.7, -34.95), (-0.72, MUZZLE_Z), (0.72, MUZZLE_Z), (1.7, -34.95), (1.7, -32.55), (1.05, -32.25)]
	return [G(x, y, z) for x, z in pts]
brake = extrude('brake', 'steel', brake_outline(BORE_Y - 0.95), Vector((0, 0, 1.9)))
bevel(brake, 0.1, 2)
cut(brake, [box('brake-port', None, (0, BORE_Y, z), (4.0, 1.12, 0.95)) for z in (-33.1, -34.45)] +
	[rod('brake-bore', None, (0, BORE_Y, -31.9), (0, BORE_Y, MUZZLE_Z - 0.5), 0.52, seg=20)], dark=True)
cut(brake, [rod('brake-vent', None, (0, BORE_Y + 0.4, z), (0, BORE_Y + 1.2, z), 0.17, seg=8) for z in (-35.25, -35.75)], dark=True)
fix(brake)
for s in (-1, 1):
	screw('brake-screw', (s * 1.2, BORE_Y + 0.68, -32.42), (s * 1.2, BORE_Y + 1.0, -32.42), 0.15)

# ---------------------------------------------------------------------
# Stock: steel body with lightening pockets, polymer cheek piece with a lock
# knob, steel butt plate and a thick grooved recoil pad, the rear sling loop.

# Slim and low: at the hip it runs along the lower right of the picture.
stock = side('stock', 'steel', [(8.0, 1.15), (9.2, 0.8), (16.25, 0.1), (16.25, -3.0), (15.1, -3.05), (11.0, -2.35), (8.0, -1.85)], -0.85, 0.85)
bevel(stock, 0.16, 2)
cut(stock, [side('stock-pocket', None, [(9.5, 0.3), (14.9, -0.3), (14.9, -2.0), (14.3, -2.3), (11.2, -1.75), (9.5, -1.4)], s * 0.73, s * 1.2) for s in (-1, 1)])
cut(stock, [rod('stock-hole', None, (-1.4, -1.35, 13.9), (1.4, -1.35, 13.9), 0.32, seg=12)], dark=True)
fix(stock)
cheek = side('cheek', 'polymer', [(9.8, 0.6), (14.9, 0.05), (14.9, 0.75), (14.5, 0.95), (10.5, 1.45), (9.8, 1.2)], -0.62, 0.62)
bevel(cheek, 0.13, 2)
cut(cheek, [side('cheek-groove', None, [(11.0, 1.3075), (14.0, 0.9325), (14.0, 1.4), (11.0, 1.75)], s * 0.34 - 0.07, s * 0.34 + 0.07) for s in (-1, 1)])
fix(cheek)
for z, y in ((11.0, 1.3875), (14.0, 1.0125)):
	screw('cheek-screw', (0, y - 0.12, z), (0, y + 0.05, z), 0.15)
qd = rod('qd-socket', 'steel', (0.8, -2.0, 15.4), (0.97, -2.0, 15.4), 0.36, seg=14)
bevel(qd, 0.03, 1)
cut(qd, [rod('qd-hole', None, (0.85, -2.0, 15.4), (1.15, -2.0, 15.4), 0.18, seg=10)], dark=True)
fix(qd)
part(rod('cheek-knob', 'steel', (-0.7, 0.1, 12.1), (-1.15, 0.1, 12.1), 0.36, seg=12), 0.04, 1)
part(box('butt-plate', 'steel', (0, -1.4, 16.36), (1.9, 3.5, 0.32)), 0.05, 1)
pad = box('pad', 'rubber', (0, -1.4, 16.96), (2.0, 3.7, 0.98))
bevel(pad, 0.18, 2)
cut(pad, [box('pad-groove', None, (0, y, BUTT_Z + 0.02), (3.2, 0.2, 0.3)) for y in (-0.1, -0.95, -1.8, -2.65)])
cut(pad, [box('pad-side', None, (s * 1.02, -1.4, z), (0.2, 4.2, 0.12)) for s in (-1, 1) for z in (16.75, 17.1)])
cut(pad, [box('pad-top', None, (0, -1.4 + s * 1.87, z), (1.7, 0.2, 0.12)) for s in (-1, 1) for z in (16.75, 17.1)])
fix(pad)
part(box('rear-swivel-base', 'steel', (0, -3.05, 14.6), (0.5, 0.3, 0.6)), 0.03, 1)
part(torus('rear-swivel', 'bright', (0, -3.55, 14.6), 'x', 0.45, 0.08, seg=16, sides=6))

# ---------------------------------------------------------------------
# Scope: a hollow anodised tube open along its axis (aimed through), large
# objective bell, eyepiece with a ribbed power ring and a rubber eyecup;
# turrets on top and right, side focus wheel on the left; two rings on
# clamping bases on the rail.

scope = lathe('scope', 'optic', [(0, OBJ_Z), (1.3, OBJ_Z), (1.42, OBJ_Z + 0.1), (1.42, -12.55), (1.36, -12.45), (1.36, -10.7), (0.82, -8.5),
	(0.82, 2.4), (1.0, 3.55), (1.07, 3.65), (1.07, 4.95), (0, 4.95)], (0, SCOPE_Y, 0), 'z', seg=32)
bevel(scope, 0.03, 1, 40)
cut(scope, [lathe('scope-bore', None, [(0, 6.5), (0.84, 6.5), (0.84, 3.7), (0.62, 2.4), (0.62, -8.4), (1.2, -10.7), (1.2, -14.2), (0, -14.2)], (0, SCOPE_Y, 0), 'z', seg=32)], dark=True)
fix(scope, 40)
# Power ring with grip ribs, throw lever on the right.
pr = rod('power-ring', 'optic', (0, SCOPE_Y, 3.8), (0, SCOPE_Y, 4.45), 1.13, seg=32)
cut(pr, [rod('pr-hole', None, (0, SCOPE_Y, 3.6), (0, SCOPE_Y, 4.65), 0.95, seg=32)], dark=True)
cut(pr, [rod('pr-rib', None, (math.cos(a) * 1.16, SCOPE_Y + math.sin(a) * 1.16, 3.7), (math.cos(a) * 1.16, SCOPE_Y + math.sin(a) * 1.16, 4.55), 0.07, seg=4)
	for a in [i * math.pi / 9 for i in range(18)]])
fix(pr, 40)
part(box('throw-lever', 'optic', (1.3, SCOPE_Y + 0.2, 4.12), (0.5, 0.26, 0.4)), 0.05, 1)
cup = lathe('eyecup', 'rubber', [(0.86, 4.9), (1.12, 4.9), (1.17, 5.3), (1.15, EYE_Z), (0.86, EYE_Z)], (0, SCOPE_Y, 0), 'z', seg=32, closed=True)
part(cup, 0.03, 1)
# Turret saddle, elevation (top) and windage (right) turrets with ribbed caps, side focus on the left.
part(box('saddle', 'optic', (0, SCOPE_Y, -3.2), (1.75, 1.75, 2.3)), 0.25, 3)
def turret(name, axis, d0, d1, d2):
	p = lambda d: tuple(axis[i] * d + (0, SCOPE_Y, -3.2)[i] for i in range(3))
	part(rod(name + '-base', 'optic', p(d0), p(d1), 0.62, seg=24), 0.04, 1)
	cap = rod(name + '-cap', 'optic', p(d1), p(d2), 0.58, seg=24)
	bevel(cap, 0.05, 1)
	u = (axis[1], axis[0], 0) if axis[2] == 0 else (1, 0, 0)
	w = (axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0])
	ribs = []
	for i in range(12):
		a = i * math.pi / 6
		o = tuple(0.61 * (math.cos(a) * u[k] + math.sin(a) * w[k]) for k in range(3))
		q0, q1 = p(d1 + 0.1), p(d2 + 0.2)
		ribs.append(rod(name + '-rib', None, tuple(q0[k] + o[k] for k in range(3)), tuple(q1[k] + o[k] for k in range(3)), 0.07, seg=4))
	cut(cap, ribs)
	fix(cap, 40)
turret('elev', (0, 1, 0), 0.6, 1.25, 1.75)
turret('wind', (1, 0, 0), 0.6, 1.25, 1.75)
part(rod('focus-base', 'optic', (-0.6, SCOPE_Y, -3.2), (-1.15, SCOPE_Y, -3.2), 0.55, seg=20), 0.04, 1)
wheel = rod('focus-wheel', 'optic', (-1.1, SCOPE_Y, -3.2), (-1.45, SCOPE_Y, -3.2), 1.0, seg=32)
bevel(wheel, 0.04, 1)
cut(wheel, [rod('fw-rib', None, (-1.0, SCOPE_Y + math.sin(a) * 1.03, -3.2 + math.cos(a) * 1.03), (-1.55, SCOPE_Y + math.sin(a) * 1.03, -3.2 + math.cos(a) * 1.03), 0.06, seg=4) for a in [i * math.pi / 10 for i in range(20)]])
fix(wheel, 40)
# Rings on clamping bases.
for z in RING_Z:
	part(ring('ring', 'steel', (0, SCOPE_Y, z), 'z', 1.05, 0.8, 0.9, seg=28), 0.03, 1)
	part(side('ring-base', 'steel', [(z - 0.55, 2.5), (z + 0.55, 2.5), (z + 0.45, 3.85), (z - 0.45, 3.85)], -0.72, 0.72), 0.05, 1)
	part(box('jaw', 'steel', (0.88, 2.44, z), (0.28, 0.5, 1.1)), 0.04, 1)
	part(rod('clamp-nut', 'steel', (0.98, 2.45, z), (1.38, 2.45, z), 0.3, seg=6, phase=math.pi / 6), 0.03, 1)
	for s in (-1, 1):
		screw('ring-screw', (s * 0.98, SCOPE_Y + 0.55, z), (s * 1.12, SCOPE_Y + 0.62, z), 0.12)

# ---------------------------------------------------------------------
# Points: where a case leaves, the seat of the magazine (it goes out along -Y
# here), where the hands take hold.

point('eject', (1.46, 1.05, -2.8), (0, 0, 0.25))
point('magwell', SEAT, (-MAG_RAKE, 0, 0))
point('grip_mag', (0, -8.05, -0.4), (-MAG_RAKE, 0, 0), under='mag')
point('grip_bolt', (2.2, 1.32, CH_Z), under='bolt')
point('hand_r', (0, -4.2, 6.1), (-0.31, 0, 0))
point('hand_l', (0, -1.6, -14.8))

# ---------------------------------------------------------------------
# The grip and fore-end where the code-built ones hold them; the sight line
# is the axis of the scope, from the eyecup to the objective.

finish(fit=dict(grip=(0, -4.2, 6.1), fore=(0, -1.6, -14.8), sight=(0, SCOPE_Y, EYE_Z), front=(0, SCOPE_Y, OBJ_Z)), budget='detailed', wear=dict(edge=2.0, grime=1.4, vary=1.2, width=2.2))
