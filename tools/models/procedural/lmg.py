"""
Light machine gun, first-person model: build.sh lmg (README.md in this folder).

Built in the model units of the code-built light machine gun
(apps/web/src/lib/render/viewmodels.ts, lmg): the bore along -Z on y = 0.6,
the muzzle at z = -27.67, the butt at z = +16.7. The grip, the fore-end under
the handguard and the ammunition box sit where the code-built ones are; the
code-built iron sights give way to a short open tube optic on the top rail,
whose axis is the sight line. The bolt moves with the charging handle, the feed
cover turns up about its front hinge and takes the rail and the optic with it,
the ammunition box drops off its mount, the belt lies in the feed tray and runs
down to the box, the trigger turns. The tray under the cover, the chamber in
the port and the inside of the box show then. common.py does the rest: one
texture set, the GLB in asset space.
"""
import os, sys, math
sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

ID = 'lmg'

# Layout of the code-built model (model units).
BORE_Y = 0.6
MUZZLE_Z = -27.67
BUTT_Z = 16.7
GRIP = (0, -4.3, 4.7)     # where the right hand closes (code-built grip at z 2.6, y -1.9)
FORE = (0, -2.0, -13.6)   # under the handguard, where the left hand cradles it
# The optic: an open tube on the axis y = AXIS_Y, from the eyepiece (OPT_REAR) to the objective (OPT_FRONT).
AXIS_Y = 4.4
OPT_REAR = 4.4
OPT_FRONT = -1.2
RAIL_Y = 3.25             # top of the rail
TUBE_IN = 0.8             # inner radius: nothing of the gun inside it, end to end
CH_Z = -1.4               # charging handle at rest
TRAVEL = 4.0              # how far it goes back (render/gun-rig.ts)
HINGE = (0, 2.05, -8.0)   # hinge of the feed cover
BOX = (-0.9, -1.9, -3.9)  # top of the ammunition box

start(ID, 'machine-gun', BORE_Y, MUZZLE_Z, surfaces={
	# Parkerised steel: greyer and more matte than the shotgun's.
	'steel': dict(SURF['steel'], base=(0.3, 0.31, 0.315), rough=0.5, metal=0.6, wear=(0.7, 0.71, 0.72), amount=1.15),
	'polymer': dict(SURF['polymer'], base=(0.17, 0.175, 0.18), wear=(0.4, 0.405, 0.41), amount=1.0),
	# The ammunition box: a dark olive accent, the colour of the gun other players see.
	'pouch': dict(SURF['polymer'], base=(0.2, 0.215, 0.165), rough=0.66, wear=(0.38, 0.39, 0.32), amount=1.0),
})

# ---------------------------------------------------------------------
# Receiver: a long steel box with the feed port (left), the charging handle
# slot and the ejection port (right); the feed cover hinged at the front,
# the riser behind it, one rail along both.

rx = [(-1.65, -1.6), (-1.35, -1.9), (1.35, -1.9), (1.65, -1.6), (1.65, 1.5), (1.35, 1.8), (-1.35, 1.8), (-1.65, 1.5)]
recv = section('receiver', 'steel', rx, -9.5, 6.5)
cut(recv, [box('side-groove', None, (s * 1.7, -0.3, -1.0), (0.2, 0.16, 14.6)) for s in (-1, 1)])
cut(recv, [box('feed-port', None, (-1.75, 1.15, -3.3), (0.6, 0.9, 2.6))], dark=True)
# The slot runs back far enough for the whole travel of the handle.
cut(recv, [box('ch-slot', None, (1.75, 0.6, (-6.8 + CH_Z + TRAVEL + 0.2) / 2), (0.6, 0.32, CH_Z + TRAVEL + 0.2 + 6.8))], dark=True)
cut(recv, [box('eject', None, (1.45, -1.0, -3.4), (1.2, 0.75, 2.6))], dark=True)
# The feed tray under the cover.
cut(recv, [box('tray', None, (0, 1.6, -3.3), (2.1, 0.7, 5.6))], mat='inner')
part(recv, 0.06)
# In the tray: the guide rails the rounds lie on, the feed ramp at the front, the bolt slot behind.
for z in (-4.0, -2.4):
	part(box('tray-rail', 'steel', (0, 1.27, z), (2.0, 0.1, 0.22)))
part(box('feed-ramp', 'bright', (0, 1.36, -5.5), (0.8, 0.22, 1.0)), 0.04, 1)
part(box('bolt-slot', 'dark', (0, 1.27, -1.4), (0.5, 0.08, 1.5)))
# Bolt face in the ejection port, the charging handle in its slot.
with moving('bolt', (0, 0.6, CH_Z)):
	bolt = box('bolt', 'bright', (1.15, -1.0, -3.4), (0.64, 0.6, 2.3))
	cut(bolt, [box('bolt-groove', None, (1.5, -1.0, -3.4), (0.2, 0.14, 2.5))], dark=True)
	part(bolt, 0.03, 1)
	part(rod('ch-stem', 'steel', (1.3, 0.6, -1.4), (2.2, 0.6, -1.4), 0.15, seg=8))
	part(rod('ch-knob', 'steel', (2.0, 0.6, -1.4), (2.6, 0.6, -1.4), 0.34, 0.3, seg=16), 0.05, 1)
# Chamber in the port, uncovered when the bolt goes back.
part(rod('breech', 'bright', (1.15, -1.0, -4.72), (1.15, -1.0, -4.5), 0.3, seg=10))
# Pins through the receiver.
for y, z in [(-1.3, 5.7), (1.15, 5.7), (-1.3, -1.6)]:
	part(rod('pin', 'bright', (-1.72, y, z), (1.72, y, z), 0.15, seg=8, phase=math.pi / 8))
# Front trunnion block, a little proud of the receiver, with its rivets.
part(section('trunnion', 'steel', [(-1.75, -1.65), (-1.45, -1.97), (1.45, -1.97), (1.75, -1.65), (1.75, 1.45), (1.45, 1.75), (-1.45, 1.75), (-1.75, 1.45)], -9.56, -7.6), 0.06)
for y in (-1.0, 0.7):
	part(rod('rivet', 'bright', (-1.82, y, -8.2), (1.82, y, -8.2), 0.13, seg=8, phase=math.pi / 8))

# Feed cover with its ribs, the hinge at the front, the latch at the rear.
part(rod('cover-hinge', 'bright', (-1.72, 2.05, -8.0), (1.72, 2.05, -8.0), 0.24, seg=10))
riser = box('riser', 'steel', (0, 2.25, 4.35), (2.5, 0.95, 4.3))
part(riser, 0.06)
with moving('cover', HINGE):
	cover = section('feed-cover', 'steel', [(-1.55, 1.75), (1.55, 1.75), (1.55, 2.35), (1.2, 2.72), (-1.2, 2.72), (-1.55, 2.35)], -8.3, 2.3)
	# Its underside: hollow, with the feed lever and two pawls.
	cut(cover, [box('cover-hollow', None, (0, 1.75, -3.3), (2.2, 0.7, 6.4))], mat='inner')
	part(cover, 0.06)
	part(box('feed-lever', 'bright', (0.45, 1.95, -3.2), (0.24, 0.24, 5.0), ('y', 0.14)), 0.03, 1)
	for x in (-0.6, 0.2):
		part(box('pawl', 'steel', (x, 1.93, -3.3), (0.5, 0.3, 0.9)), 0.04, 1)
	for s in (-1, 1):
		part(box('latch', 'steel', (s * 1.66, 2.2, 1.7), (0.2, 0.55, 0.8)), 0.03, 1)
	rail = section('rail', 'steel', [(-0.62, 2.7), (0.62, 2.7), (0.62, 2.88), (0.78, 3.0), (0.78, 3.1), (0.6, RAIL_Y), (-0.6, RAIL_Y), (-0.78, 3.1), (-0.78, 3.0), (-0.62, 2.88)], -6.6, 6.2)
	bevel(rail, 0.03, 1)
	cut(rail, [box('rs%d' % i, None, (0, 3.17, -5.9 + i * 0.85), (2.0, 0.4, 0.32)) for i in range(14)])
	fix(rail)

# Feed tray on the left, the belt coming up from the box into it: rounds with their links.
part(box('feed-tray', 'steel', (-2.05, 1.0, -3.3), (0.9, 0.24, 2.8)), 0.04, 1)
with moving('belt', (-2.15, 1.4, -2.9)):
	# The last three rounds lie in the tray, under the cover.
	RND = [(-0.05, 1.5), (-0.78, 1.5), (-1.48, 1.5)]
	IN_TRAY = len(RND)
	for i in range(5):
		t = i / 4
		RND.append((-2.15 - math.sin(t * math.pi) * 0.55 - t * 0.1, 1.4 - t * 3.05))
	for x, y in RND:
		case = lathe('round', 'brass', [(0, 0.0), (0.22, 0.0), (0.2, -0.1), (0.2, -1.35), (0.14, -1.6), (0.12, -2.0), (0.05, -2.32), (0, -2.38)], (x, y, -2.05), 'z', seg=6)
		part(case, None, angle=40)
		part(ring('link', 'steel', (x, y, -2.75), 'z', 0.27, 0.19, 0.42, seg=6))
	for (x0, y0), (x1, y1) in zip(RND[IN_TRAY:], RND[IN_TRAY + 1:]):
		part(box('link-tab', 'steel', ((x0 + x1) / 2 - 0.1, (y0 + y1) / 2, -2.4), (0.12, abs(y1 - y0) * 0.75, 0.3), ('z', math.atan2(x1 - x0, y0 - y1))))

# Trigger housing under the receiver, the guard, the trigger, the cross-bolt safety.
# Just behind the ammunition box, which drops past it.
housing = side('housing', 'polymer', [(-1.08, -1.8), (6.45, -1.8), (6.45, -2.2), (6.0, -2.5), (-0.7, -2.5), (-1.08, -2.2)], -1.35, 1.35)
part(housing, 0.07)
# The bow is deep enough for a gloved finger under the housing.
guard = side('guard', 'polymer', [(-1.0, -1.8), (-0.7, -3.75), (2.4, -4.0), (3.35, -3.3), (3.0, -1.8)], -0.42, 0.42)
cut(guard, [side('guard-hole', None, [(-0.4, -1.7), (-0.2, -3.35), (2.3, -3.57), (2.85, -3.12), (2.55, -1.7)], -1, 1)])
part(guard, 0.06, 1)
with moving('trigger', (0, -2.3, 1.25)):
	part(side('trigger', 'bright', [(1.05, -2.4), (1.45, -2.4), (1.58, -2.8), (1.4, -3.3), (1.22, -3.27), (1.32, -2.8)], -0.16, 0.16), 0.03, 1)
part(rod('safety', 'bright', (-1.55, -2.15, 3.6), (1.55, -2.15, 3.6), 0.2, seg=12), 0.03, 1)
for z in (0.3, 5.2):
	part(rod('housing-pin', 'bright', (-1.42, -2.15, z), (1.42, -2.15, z), 0.13, seg=8, phase=math.pi / 8))

# Pistol grip with finger grooves and inset grip panels (the code-built grip's place and rake).
grip = side('grip', 'polymer', [(2.6, -1.9), (3.05, -3.3), (2.95, -3.6), (3.4, -4.75), (3.3, -5.05), (3.8, -6.2), (4.1, -6.55), (6.75, -6.55), (6.8, -6.2), (5.75, -2.8), (5.85, -2.25), (6.25, -1.9)], -1.0, 1.0)
part(grip, 0.14, 1)
for s in (-1, 1):
	part(side('grip-panel', 'rubber', [(3.55, -2.7), (4.25, -5.8), (6.0, -5.8), (5.3, -2.7)], s * 0.9, s * 1.09), 0.035, 1)
	screw('panel-screw', (s * 1.05, -4.3, 4.8), (s * 1.16, -4.3, 4.8), 0.15)

# ---------------------------------------------------------------------
# Ammunition box under the receiver, left of centre: lid seam, latch, ribs,
# the mounting plate; the belt leaves it at the top left.

# The mount goes into the open top of the box, clear of its walls and of the mouth the belt comes out of.
part(box('ammo-mount', 'steel', (-0.5, -2.0, -3.9), (1.9, 0.3, 4.2)), 0.05, 1)
with moving('mag', BOX):
	ammo = box('ammo', 'pouch', (-0.9, -4.2, -3.9), (3.6, 4.6, 5.4))
	bevel(ammo, 0.2, 1)
	# The lid seam all round (two cuts: cutters in one cut must not overlap), ribs on the left face.
	cut(ammo, [box('seam', None, (-0.9 + s * 1.8, -2.75, -3.9), (0.14, 0.1, 6.0)) for s in (-1, 1)])
	cut(ammo, [box('seam', None, (-0.9, -2.75, -3.9 + s * 2.7), (3.4, 0.1, 0.14)) for s in (-1, 1)])
	cut(ammo, [box('rib', None, (-2.75, -4.7, z), (0.14, 2.6, 0.22)) for z in (-5.4, -4.3, -3.2)])
	# Open on top under the mount: the belt inside, and the next rounds of it under the mouth.
	cut(ammo, [box('ammo-inside', None, (-1.0, -2.5, -3.9), (3.1, 1.4, 4.8))], mat='inner')
	fix(ammo, 40)
	for x, y in ((-1.6, -2.75), (-1.0, -2.9), (-0.4, -2.8)):
		cartridge('boxed', (x, y, -2.1), 2.38, 0.22, seg=6)
	part(box('ammo-latch', 'steel', (0.95, -2.9, -3.9), (0.16, 0.8, 0.9)), 0.03, 1)
	part(rod('latch-pin', 'bright', (0.95, -2.55, -4.25), (0.95, -2.55, -3.55), 0.08, seg=6))
	# The mouth: a frame round the belt, which runs up through it.
	mouth = box('ammo-mouth', 'pouch', (-2.23, -1.95, -3.2), (0.94, 0.5, 2.9))
	bevel(mouth, 0.05, 1)
	cut(mouth, [box('mouth-way', None, (-2.23, -1.9, -3.2), (0.72, 1.2, 2.66))], mat='inner')
	fix(mouth, 40)

# ---------------------------------------------------------------------
# Barrel: the barrel nut with the carry handle, the handguard where the left
# hand holds, the gas block, the ribbed barrel and the flash hider.

part(rod('barrel', 'steel', (0, BORE_Y, -9.0), (0, BORE_Y, -19.0), 0.8, seg=16))
nut = rod('barrel-nut', 'steel', (0, BORE_Y, -9.4), (0, BORE_Y, -10.75), 1.18, seg=24)
cut(nut, [box('nut-flat', None, (s * 1.25, BORE_Y, -10.1), (0.3, 3, 2)) for s in (-1, 1)])
part(nut, 0.05, 1)

hg = section('handguard', 'polymer', [(-0.95, -2.0), (0.95, -2.0), (1.35, -1.55), (1.35, 1.25), (0.95, 1.85), (-0.95, 1.85), (-1.35, 1.25), (-1.35, -1.55)], -10.7, -18.2)
bevel(hg, 0.07, 1)
holes = []
for i in range(4):
	z = -11.6 - i * 1.75
	for s in (-1, 1):
		holes.append(box('vent', None, (s * 1.45, 0.75, z), (0.6, 0.36, 1.3)))
	holes.append(box('top-vent', None, (0, 1.95, z), (1.0, 0.4, 0.95)))
cut(hg, holes, dark=True)
cut(hg, [box('groove', None, (0, -2.08, z), (3.4, 0.3, 0.32)) for z in (-12.0, -13.6, -15.2)])
fix(hg)
part(section('hg-cap', 'steel', [(-1.0, -2.05), (1.0, -2.05), (1.4, -1.58), (1.4, 1.28), (1.0, 1.9), (-1.0, 1.9), (-1.4, 1.28), (-1.4, -1.58)], -18.2, -18.6), 0.05, 1)
for s in (-1, 1):
	for z in (-17.7,):
		screw('hg-screw', (s * 1.3, -0.9, z), (s * 1.44, -0.9, z), 0.14)
part(box('swivel-base', 'steel', (-1.45, -1.3, -17.5), (0.3, 0.45, 0.45)), 0.03, 1)
part(torus('swivel', 'bright', (-1.68, -1.85, -17.5), 'z', 0.42, 0.08, seg=10, sides=4))

# Carry handle over the handguard: a hinge on the barrel nut, two arms, a polymer bar
# low enough to stay out of the optic's view.
HB_Y = 2.75
part(box('handle-hinge', 'steel', (0, 1.85, -10.1), (1.1, 0.55, 0.9)), 0.04, 1)
part(rod('handle-pin', 'bright', (-0.62, 1.9, -10.1), (0.62, 1.9, -10.1), 0.15, seg=8))
part(box('handle-arm', 'steel', (0, 2.33, -10.5), (0.7, 1.15, 0.4), ('x', -0.6)), 0.04, 1)
part(box('handle-arm', 'steel', (0, 2.3, -14.0), (0.7, 1.1, 0.4), ('x', 0.45)), 0.04, 1)
part(box('handle-lug', 'steel', (0, 1.95, -14.25), (0.9, 0.4, 0.7)), 0.04, 1)
handle = rod('handle', 'polymer', (0, HB_Y, -10.75), (0, HB_Y, -13.85), 0.36, seg=12)
part(handle, 0.05, 1)

# Gas block: a clamp round the barrel, the cylinder below it with its pin and regulator.
part(rod('gas-tube', 'steel', (0, -0.75, -18.4), (0, -0.75, -19.0), 0.32, seg=12))
part(rod('gas-clamp', 'steel', (0, BORE_Y, -18.75), (0, BORE_Y, -20.25), 1.05, seg=16), 0.05, 1)
part(box('gas-body', 'steel', (0, -0.55, -19.5), (1.25, 1.5, 1.4)), 0.06)
part(rod('gas-pin', 'bright', (-0.68, -0.55, -19.5), (0.68, -0.55, -19.5), 0.11, seg=8), 0.015, 1)
reg = rod('regulator', 'steel', (0, -0.75, -20.2), (0, -0.75, -20.75), 0.42, seg=12)
cut(reg, [box('reg-slot', None, (0, -0.75, -20.75), (0.16, 1.0, 0.25))], dark=True)
fix(reg, 40)

# Ribbed barrel ahead of the gas block.
prof = [(0.8, 0.0), (0.8, -0.6)]
z = -0.6
for i in range(5):
	prof += [(0.8, z), (0.68, z - 0.08), (0.68, z - 0.38), (0.8, z - 0.46)]
	z -= 0.92
prof += [(0.8, -5.6)]
part(lathe('ribs', 'steel', prof, (0, BORE_Y, -20.0), 'z', seg=12), None, angle=35)

# Flash hider: a slotted cage with a chamfered crown, the bore dark.
hider = lathe('hider', 'steel', [(0.0, 0.0), (0.82, 0.0), (0.82, -0.2), (0.9, -0.32), (0.9, -1.95), (0.8, -2.07), (0.0, -2.07)], (0, BORE_Y, -25.6), 'z', seg=16)
cut(hider, [rod('bore', None, (0, BORE_Y, -26.0), (0, BORE_Y, -28.0), 0.46, seg=16)], dark=True)
slots = []
for k in range(4):
	a = k * math.pi / 2 + math.pi / 4
	slots.append(box('hslot', None, (0.8 * math.cos(a), BORE_Y + 0.8 * math.sin(a), -26.95), (0.26, 0.26, 1.5)))
cut(hider, slots, dark=True)
fix(hider, 40)

# ---------------------------------------------------------------------
# Optic: a short tube on two rings, open from the eyepiece to the objective
# (no glass: aimed, the game's red dot at the objective is the aim mark),
# a saddle with the elevation, windage and brightness knobs.

with moving('cover', HINGE):
	tube = lathe('tube', 'steel', [(TUBE_IN, OPT_REAR), (1.02, OPT_REAR), (1.06, OPT_REAR - 0.1), (1.06, 3.35), (0.94, 3.1), (0.94, 0.3), (1.08, -0.1), (1.12, -0.95), (1.06, OPT_FRONT), (TUBE_IN, OPT_FRONT)], (0, AXIS_Y, 0), 'z', seg=24, closed=True)
	part(tube, None, angle=30)
	part(ring('saddle', 'steel', (0, AXIS_Y, 1.55), 'z', 1.08, 0.88, 0.95, seg=16), 0.03, 1)
	for name, p0, p1, r in (('elevation', (0, AXIS_Y + 0.95, 1.55), (0, AXIS_Y + 1.45, 1.55), 0.4), ('windage', (0.95, AXIS_Y, 1.55), (1.45, AXIS_Y, 1.55), 0.4), ('brightness', (-0.95, AXIS_Y, 1.55), (-1.4, AXIS_Y, 1.55), 0.36)):
		part(rod(name, 'steel', p0, p1, r, seg=10), 0.04, 1)
	for z in (2.55, 0.55):
		part(ring('mount-ring', 'steel', (0, AXIS_Y, z), 'z', 1.16, 0.92, 0.5, seg=14), None)
		part(box('mount-base', 'steel', (0, 3.6, z), (1.4, 0.7, 0.55)), 0.04, 1)
		part(box('mount-clamp', 'steel', (-0.85, 3.4, z), (0.35, 0.5, 0.55)), 0.03, 1)
		part(rod('clamp-nut', 'bright', (-1.0, 3.4, z), (-1.25, 3.4, z), 0.2, seg=6))

# ---------------------------------------------------------------------
# Solid stock: inset side panels, a sling hole, rubber butt pad.

part(section('stock-plate', 'steel', [(-1.4, -1.75), (1.4, -1.75), (1.4, 1.55), (-1.4, 1.55)], 6.3, 6.9), 0.06)
# Slim, and its comb falls away to the butt: aimed and at the hip it lies along the bottom of the picture.
stock = side('stock', 'polymer', [(6.8, 1.35), (8.2, 1.1), (15.95, -0.15), (15.95, -3.7), (13.0, -3.35), (8.6, -1.55), (6.8, -1.7)], -0.9, 0.9)
# Rounded top and bottom edges first (the comb reads as a form, not a slab, when aimed), then the cuts.
bevel(stock, 0.28, 1)
for s in (-1, 1):
	cut(stock, [side('stock-panel', None, [(9.0, 0.35), (14.7, -0.6), (14.7, -2.45), (13.0, -2.25), (9.4, -0.6), (9.0, -0.5)], s * 0.8, s * 1.6)])
cut(stock, [rod('sling-hole', None, (-1.5, -2.95, 15.2), (1.5, -2.95, 15.2), 0.24, seg=12)], dark=True)
fix(stock, 40)
pad = box('butt-pad', 'rubber', (0, -1.925, 16.3), (1.9, 3.65, 0.8))
bevel(pad, 0.18, 1)
cut(pad, [box('pad-groove', None, (0, y, 16.72), (3.0, 0.2, 0.3)) for y in (-0.6, -1.4, -2.2, -3.0)])
fix(pad)
part(box('stock-latch', 'bright', (0, -1.78, 7.4), (0.9, 0.3, 0.5)), 0.03, 1)

# ---------------------------------------------------------------------
# Points: where a case leaves, the seat of the ammunition box (it goes out along
# -Y), where the hands take hold.

point('eject', (1.67, -1.0, -3.4), (0, 0, -0.35))
point('magwell', BOX)
point('grip_mag', (BOX[0], -6.5, BOX[2]), under='mag')
point('grip_bolt', (2.3, 0.6, CH_Z), under='bolt')
point('hand_r', GRIP, (-0.31, 0, 0))
point('hand_l', FORE)

# ---------------------------------------------------------------------
# The grip and fore-end where the code-built ones hold them, the sight line
# along the axis of the optic, from the eyepiece to the objective.

finish(fit=dict(grip=GRIP, fore=FORE, sight=(0, AXIS_Y, OPT_REAR), front=(0, AXIS_Y, OPT_FRONT)), budget='plain', wear=dict(edge=1.6, grime=1.3, vary=0.6, width=1.5))
