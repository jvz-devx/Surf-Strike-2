"""
Auto shotgun, first-person model: build.sh striker (README.md in this folder).

Built in the model units of the code-built shotgun
(apps/web/src/lib/render/viewmodels.ts, autoShotgun): the bore along -Z on
y = 0.8, the muzzle at z = -25.32, the butt at z = +15.45 (the code-built
shotgun's stock is longer and taller). The bolt moves with the charging
handle, the drum drops out of the saddle of the feed tower, the trigger turns;
the chamber in the port, the well in the tower and the shell in the neck of the
drum show then. common.py does the rest: one texture set, the GLB in asset space.
"""
import os, sys, math
sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

ID = 'striker'

# Layout of the code-built model (model units).
BORE_Y = 0.8
MUZZLE_Z = -25.32
SIGHT_Y = 3.5      # ghost ring centre and front post tip: a level sight line
REAR_Z = 4.6       # ghost ring
POST_Z = -23.0     # front post
DRUM = (-5.6, -3.4)  # drum axis (y, z)
CH_Z = -2.2        # charging handle at rest
TRAVEL = 4.0       # how far it goes back (render/gun-rig.ts)

start(ID, 'shotgun', BORE_Y, MUZZLE_Z, surfaces={
	# The drum shell: a slightly warmer polymer than the furniture.
	'drum': dict(SURF['polymer'], base=(0.21, 0.21, 0.205), rough=0.58, wear=(0.38, 0.38, 0.375)),
})

# ---------------------------------------------------------------------
# Receiver: steel upper with the ejection port (right) and the charging
# handle slot (left), polymer lower with the trigger guard, pins and controls.

upper = section('upper', 'steel', [(-1.55, 0.1), (1.55, 0.1), (1.55, 1.5), (1.2, 1.95), (-1.2, 1.95), (-1.55, 1.5)], -8.0, 5.8)
bevel(upper, 0.07)
cut(upper, [box('port', None, (1.35, 1.0, -3.0), (2.1, 0.85, 3.0))], dark=True)
# The slot runs back far enough for the whole travel of the handle.
cut(upper, [box('slot', None, (-1.7, 1.05, (-6.2 + CH_Z + TRAVEL + 0.2) / 2), (0.9, 0.3, CH_Z + TRAVEL + 0.2 + 6.2))], dark=True)
fix(upper)
# Chamber in the port, uncovered when the bolt goes back: the breech ring and the hole in it.
breech = rod('breech', 'bright', (0.85, 1.0, -4.55), (0.85, 1.0, -4.3), 0.4, seg=12)
cut(breech, [rod('breech-hole', None, (0.85, 1.0, -4.45), (0.85, 1.0, -4.0), 0.28, seg=10)], dark=True)
fix(breech, 40)
BOLT = (0, 1.0, CH_Z)
with moving('bolt', BOLT):
	# Bolt in the port: a flat face with the extractor groove.
	bolt = box('bolt', 'bright', (0.92, 1.0, -3.0), (0.9, 0.62, 2.7))
	cut(bolt, [box('groove', None, (1.4, 1.0, -3.0), (0.2, 0.14, 2.9))], dark=True)
	part(bolt, 0.03, 1)
	# Charging handle: stem in the slot and a knob.
	part(rod('ch-stem', 'steel', (-1.3, 1.05, -2.2), (-2.25, 1.05, -2.2), 0.13, seg=10))
	part(rod('ch-knob', 'steel', (-2.05, 1.05, -2.2), (-2.6, 1.05, -2.2), 0.32, 0.3, seg=16), 0.05, 1)
# Top rail: bevelled first, then the cross slots.
rail = section('rail', 'steel', [(-0.62, 1.9), (0.62, 1.9), (0.62, 2.15), (0.78, 2.3), (0.78, 2.42), (0.6, 2.58), (-0.6, 2.58), (-0.78, 2.42), (-0.78, 2.3), (-0.62, 2.15)], -7.4, 3.3)
bevel(rail, 0.03, 1)
cut(rail, [box('rs%d' % i, None, (0, 2.5, -6.6 + i * 0.7), (2.0, 0.4, 0.3)) for i in range(13)])
fix(rail)
# Barrel nut at the front of the receiver.
part(rod('nut', 'steel', (0, BORE_Y, -8.0), (0, BORE_Y, -8.7), 1.08, 1.0, seg=24), 0.05, 1)

lower = side('lower', 'polymer', [(-8.4, 0.2), (6.0, 0.2), (6.0, -1.2), (5.4, -1.72), (-7.6, -1.72), (-8.4, -0.9)], -1.66, 1.66)
part(lower, 0.08)
# Trigger guard: the opening is cut out of the solid guard.
guard = side('guard', 'polymer', [(-0.8, -1.6), (-0.5, -3.3), (2.6, -3.55), (3.55, -2.9), (3.2, -1.6)], -0.42, 0.42)
cut(guard, [side('guard-hole', None, [(-0.2, -1.5), (0.0, -2.9), (2.5, -3.12), (3.05, -2.72), (2.75, -1.5)], -1, 1)])
part(guard, 0.06)
with moving('trigger', (0, -1.65, 1.45)):
	part(side('trigger', 'bright', [(1.25, -1.6), (1.65, -1.6), (1.78, -2.25), (1.6, -2.85), (1.42, -2.82), (1.52, -2.25)], -0.16, 0.16), 0.03, 1)
# Pins through the lower, the safety lever on the left, the magazine catch.
for y, z in [(-0.65, 1.0), (-0.65, 4.6), (-1.1, -6.7)]:
	part(rod('pin', 'bright', (-1.72, y, z), (1.72, y, z), 0.16, seg=8, phase=math.pi / 8))
part(rod('safety-hub', 'steel', (-1.62, -0.25, 3.5), (-1.8, -0.25, 3.5), 0.34, seg=16), 0.03, 1)
part(box('safety-lever', 'steel', (-1.78, -0.6, 3.05), (0.12, 0.3, 1.1), ('x', -0.6)), 0.03, 1)
part(box('catch', 'steel', (0, -1.95, -1.45), (1.3, 0.36, 0.42)), 0.04, 1)
# Feed tower: its bottom is a saddle on the drum, the neck of the drum goes up into it.
tower = box('tower', 'polymer', (0, -2.35, -3.4), (2.5, 1.5, 3.3))
cut(tower, [rod('saddle', None, (-2, DRUM[0], DRUM[1]), (2, DRUM[0], DRUM[1]), 3.31, seg=28)], mat='inner')
cut(tower, [box('tower-well', None, (0, -2.2, DRUM[1]), (1.7, 1.0, 2.4))], mat='inner')
part(tower, 0.08, 1)

# Pistol grip with finger grooves and inset grip panels.
grip = side('grip', 'polymer', [(2.8, -1.7), (3.25, -3.1), (3.15, -3.4), (3.6, -4.55), (3.5, -4.85), (4.0, -6.0), (4.3, -6.35), (6.95, -6.35), (7.0, -6.0), (5.95, -2.6), (6.05, -2.05), (6.45, -1.7)], -1.0, 1.0)
part(grip, 0.14, 2)
for s in (-1, 1):
	panel = side('panel', 'rubber', [(3.75, -2.5), (4.45, -5.6), (6.2, -5.6), (5.5, -2.5)], s * 0.9, s * 1.09)
	part(panel, 0.035, 2)
	screw('panel-screw', (s * 1.05, -4.1, 5.0), (s * 1.16, -4.1, 5.0), 0.15)

# ---------------------------------------------------------------------
# Sights: ghost ring with protective ears on the rear of the receiver, a
# post on a clamp ahead of the heat shield. Ring centre and post tip are level.

part(box('rear-base', 'steel', (0, 2.2, REAR_Z), (2.6, 0.55, 1.4)), 0.06)
part(box('rear-stem', 'steel', (0, 2.62, REAR_Z), (0.6, 0.5, 0.34)), 0.03, 1)
part(ring('ghost-ring', 'steel', (0, SIGHT_Y, REAR_Z), 'z', 0.9, 0.66, 0.32, seg=28), 0.03, 1)
for s in (-1, 1):
	ear = side('ear', 'steel', [(3.95, 2.4), (5.25, 2.4), (5.05, 3.45), (4.55, 3.72), (4.15, 3.45)], s * 1.02, s * 1.3)
	part(ear, 0.04, 2)
part(rod('elevation', 'bright', (1.3, 2.2, REAR_Z), (1.48, 2.2, REAR_Z), 0.2, seg=14))

clamp = section('post-clamp', 'steel', [(-0.75, 0.9), (0.75, 0.9), (0.85, 1.4), (0.55, 2.25), (-0.55, 2.25), (-0.85, 1.4)], POST_Z + 0.55, POST_Z - 0.55)
part(clamp, 0.05)
part(side('post', 'steel', [(POST_Z - 0.06, 2.15), (POST_Z + 0.5, 2.15), (POST_Z + 0.12, SIGHT_Y), (POST_Z - 0.06, SIGHT_Y)], -0.12, 0.12), 0.015, 1)
for s in (-1, 1):
	part(side('post-wing', 'steel', [(POST_Z - 0.4, 2.15), (POST_Z + 0.45, 2.15), (POST_Z + 0.25, 3.05), (POST_Z - 0.3, 3.05)], s * 0.45, s * 0.66), 0.03, 1)
part(rod('clamp-screw', 'bright', (0.85, 1.35, POST_Z), (1.0, 1.35, POST_Z), 0.13, seg=10))

# ---------------------------------------------------------------------
# Barrel, muzzle (turned: a slight flare, chamfered crown, the bore) with two
# top ports, the perforated heat shield.

part(rod('barrel', 'steel', (0, BORE_Y, -8.4), (0, BORE_Y, -23.75), 0.72, seg=32))
muzzle = lathe('muzzle', 'steel', [(0.84, 0.0), (0.97, -1.48), (0.91, -1.62), (0.6, -1.62), (0.5, -1.5), (0.5, 0.0)], (0, BORE_Y, -23.7), 'z', seg=32, closed=True)
cut(muzzle, [box('mport%d' % i, None, (0, BORE_Y + 0.8, z), (0.62, 1.0, 0.26)) for i, z in enumerate((-24.15, -24.7))], dark=True)
fix(muzzle)

R_OUT, R_IN = 1.34, 1.22
a0, a1 = math.radians(-32), math.radians(212)
arc = [(math.cos(a0 + (a1 - a0) * i / 24), math.sin(a0 + (a1 - a0) * i / 24)) for i in range(25)]
shield = section('shield', 'steel', [(R_OUT * c, BORE_Y + R_OUT * s) for c, s in arc] + [(R_IN * c, BORE_Y + R_IN * s) for c, s in reversed(arc)], -9.0, -20.9)
bevel(shield, 0.03, 1)
holes = []
for row, ang in enumerate((54, 90, 126)):
	a = math.radians(ang)
	n = 8 if row == 1 else 9
	for i in range(n):
		z = -9.95 - i * 1.25 - (0.62 if row == 1 else 0)
		holes.append(rod('hole', None, (0.9 * math.cos(a), BORE_Y + 0.9 * math.sin(a), z), (1.7 * math.cos(a), BORE_Y + 1.7 * math.sin(a), z), 0.24, seg=8, phase=math.pi / 8))
cut(shield, holes, dark=True)
fix(shield, 40)
for z0, z1 in ((-9.0, -9.45), (-20.45, -20.9)):
	part(rod('band', 'steel', (0, BORE_Y, z0), (0, BORE_Y, z1), 1.42, seg=28), 0.04, 1)

# ---------------------------------------------------------------------
# Handguard under the barrel with vent slots, its steel end cap, the gas
# tube and block, the front sling loop.

hg = section('handguard', 'polymer', [(-1.5, 0.3), (-1.5, -1.2), (-1.2, -1.85), (-0.6, -2.05), (0.6, -2.05), (1.2, -1.85), (1.5, -1.2), (1.5, 0.3)], -8.5, -18.2)
bevel(hg, 0.07, 1)
slots = []
for z in (-10.0, -11.85, -13.7, -15.55):
	for s in (-1, 1):
		slots.append(box('vent', None, (s * 1.6, -0.45, z), (0.6, 0.34, 1.45)))
cut(hg, slots, dark=True)
# Two finger ridges across the bottom.
cut(hg, [box('ridge', None, (0, -2.12, z), (3.4, 0.3, 0.32)) for z in (-11.0, -14.6)])
fix(hg)
part(section('hg-cap', 'steel', [(-1.55, 0.35), (1.55, 0.35), (1.55, -1.2), (1.22, -1.9), (0.6, -2.1), (-0.6, -2.1), (-1.22, -1.9), (-1.55, -1.2)], -18.2, -18.75), 0.05, 1)
for s in (-1, 1):
	for z in (-9.3, -17.6):
		screw('hg-screw', (s * 1.46, -0.9, z), (s * 1.58, -0.9, z), 0.14)
part(rod('gas-tube', 'steel', (0, -0.3, -18.6), (0, -0.3, -21.5), 0.36, seg=16))
part(box('gas-block', 'steel', (0, 0.3, -21.3), (1.3, 1.9, 1.0)), 0.06)
part(rod('gas-pin', 'bright', (-0.68, -0.3, -21.3), (0.68, -0.3, -21.3), 0.1, seg=8))
part(box('swivel-base', 'steel', (-1.62, -1.3, -18.47), (0.3, 0.45, 0.45)), 0.03, 1)
part(torus('swivel', 'bright', (-1.85, -1.85, -18.47), 'z', 0.42, 0.08, seg=12, sides=5))

# ---------------------------------------------------------------------
# Drum magazine, turned: recessed faces inside a rim, two grooves round the
# band (three ribs). Six spokes on each face, a steel hub with a screw, the
# winding key on the right.

with moving('mag', (0, DRUM[0], DRUM[1])):
	DY, DZ = DRUM
	drum = lathe('drum', 'drum', [(0, -1.62), (2.75, -1.62), (2.86, -1.8), (3.16, -1.8), (3.3, -1.66),
		(3.3, -0.86), (3.17, -0.78), (3.17, -0.52), (3.3, -0.44), (3.3, 0.44), (3.17, 0.52), (3.17, 0.78), (3.3, 0.86),
		(3.3, 1.66), (3.16, 1.8), (2.86, 1.8), (2.75, 1.62), (0, 1.62)], (0, DY, DZ), 'x', seg=36)
	fix(drum, 30)
	for s in (-1, 1):
		for i in range(6):
			a = i * math.pi / 3 + math.pi / 6
			r = 1.95
			part(box('spoke', 'drum', (s * 1.66, DY + r * math.sin(a), DZ + r * math.cos(a)), (0.2, 0.26, 1.6), ('x', -a)), 0.03, 1)
		part(rod('hub', 'steel', (s * 1.55, DY, DZ), (s * 1.98, DY, DZ), 1.05, 0.98, seg=24), 0.04, 1)
		screw('hub-screw', (s * 1.93, DY, DZ), (s * 2.08, DY, DZ), 0.36, seg=12)
	# Winding key: a flat lever folded down along the right face.
	part(box('key', 'steel', (2.04, DY - 0.75, DZ + 0.45), (0.1, 0.42, 2.0), ('x', 0.55)), 0.025, 1)
	part(rod('key-knob', 'steel', (2.0, DY - 1.55, DZ + 0.95), (2.35, DY - 1.55, DZ + 0.95), 0.22, seg=12), 0.03, 1)
	# Neck with the next shell in its mouth.
	neck = box('neck', 'steel', (0, DY + 3.45, DZ), (1.6, 0.9, 2.3))
	cut(neck, [box('neck-mouth', None, (0, DY + 3.85, DZ), (1.1, 0.6, 1.95))], mat='inner')
	part(neck)
	cartridge('shell', (0, DY + 3.6, DZ + 0.9), 1.8, 0.36, seg=8, case=0.8)

# ---------------------------------------------------------------------
# Skeleton stock on a side-folding hinge, rubber butt pad, rear sling hole.

part(box('hinge-block', 'steel', (0, 0.15, 6.15), (2.9, 2.7, 0.75)), 0.06)
part(rod('hinge-pin', 'bright', (1.52, -1.0, 6.15), (1.52, 1.3, 6.15), 0.28, seg=14), 0.03, 1)
# The comb drops a little to the heel; the struts are slimmer than the receiver.
stock = side('stock', 'polymer', [(6.4, 1.45), (14.55, 1.1), (14.55, -3.15), (13.2, -3.0), (8.5, -1.1), (6.4, -0.95)], -0.6, 0.6)
cut(stock, [side('window', None, [(8.0, 0.82), (13.85, 0.55), (13.85, -2.3), (13.1, -2.22), (8.85, -0.5), (8.0, -0.42)], -1.0, 1.0)])
cut(stock, [rod('sling-hole', None, (-1.0, -2.68, 14.15), (1.0, -2.68, 14.15), 0.2, seg=12)], dark=True)
part(stock, 0.09)
pad = box('butt-pad', 'rubber', (0, -1.0, 15.0), (1.55, 4.7, 0.9))
bevel(pad, 0.11, 2)
cut(pad, [box('pad-groove', None, (0, y, 15.52), (1.9, 0.2, 0.3)) for y in (0.75, -0.25, -1.25, -2.25)])
fix(pad)

# ---------------------------------------------------------------------
# Points: where a case leaves, the seat of the drum (it goes out along -Y),
# where the hands take hold.

point('eject', (1.57, 1.0, -3.0), (0, 0, 0.3))
point('magwell', (0, DRUM[0], DRUM[1]))
point('grip_mag', (0, DRUM[0] - 3.3, DRUM[1]), under='mag')
point('grip_bolt', (-2.35, 1.05, CH_Z), under='bolt')
point('hand_r', (0, -4.1, 4.9), (-0.31, 0, 0))
point('hand_l', (0, -2.05, -12.6))

# ---------------------------------------------------------------------
# The grip and fore-end where the code-built ones hold them, the sight line
# from the middle of the ghost ring over the tip of the front post.

finish(fit=dict(grip=(0, -4.1, 4.9), fore=(0, -2.0, -12.6), sight=(0, SIGHT_Y, REAR_Z), front=(0, SIGHT_Y, POST_Z)), budget='plain')
