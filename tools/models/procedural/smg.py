"""
Submachine gun, first-person model: build.sh smg (README.md in this folder).

Built in the model units of the code-built SMG
(apps/web/src/lib/render/viewmodels.ts, smg): the bore along -Z on y = 0.9,
the muzzle at z = -13.27, the grip, the tube magazine under the barrel (the
fore-end), the sights and the wire stock folded forward along the right side
where the code-built ones are. The tube magazine carries the handguard and the
lower half of the front band, so it drops out downwards as one piece; the bolt
moves with the charging handle, the trigger turns. The trough and the feed
slot over the magazine, the chamber in the port and the feed mouth on the tube
show when they move. common.py does the rest: one texture set, the GLB in asset space.
"""
import os, sys, math
sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

ID = 'smg'

# Layout of the code-built model (model units).
BORE_Y = 0.9
MUZZLE_Z = -13.27
SIGHT_Y = 3.25     # aperture centre and front post tip: a level sight line
REAR_Z = 4.3       # rear aperture
POST_Z = -6.8      # front post in its hood
MAG_Y = -1.9       # axis of the tube magazine under the barrel
GRIP = (2.4, -1.5)  # top front corner of the pistol grip (z, y)
CH_Z = -1.9         # charging handle at rest
TRAVEL = 3.0        # how far it goes back (render/gun-rig.ts)

start(ID, 'submachine gun', BORE_Y, MUZZLE_Z, surfaces={
	# Parkerised steel: darker and rougher than the shotgun's.
	# Worn edges a good deal lighter than the base, so they read from the hip.
	'steel': dict(SURF['steel'], base=(0.3, 0.31, 0.32), rough=0.55, wear=(0.82, 0.83, 0.84), wrough=0.25),
	'polymer': dict(SURF['polymer'], wear=(0.48, 0.485, 0.49), wrough=0.4),
	# Cartridge cases seen through the magazine window.
	'brass': dict(SURF['bright'], base=(0.56, 0.43, 0.21), wear=(0.78, 0.64, 0.38), rough=0.36, amount=0.5),
	'inner': dict(SURF['inner']),
})

def hull(pts):
	"""Convex hull of 2D points, counter-clockwise."""
	pts = sorted(set(pts))
	def half(ps):
		h = []
		for p in ps:
			while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0]) <= 0:
				h.pop()
			h.append(p)
		return h
	lo, hi = half(pts), half(reversed(pts))
	return lo[:-1] + hi[:-1]

def circle(cx, cy, r, n=20):
	return [(round(cx + r * math.cos(2 * math.pi * i / n), 5), round(cy + r * math.sin(2 * math.pi * i / n), 5)) for i in range(n)]

# ---------------------------------------------------------------------
# Receiver: a stamped steel box with recessed side panels, the ejection port
# (right) and the charging handle slot (left), pins and rivets; a serrated top
# strap between the sights; the polymer end cap.

body = section('receiver', 'steel', [(-1.15, -1.5), (1.15, -1.5), (1.4, -1.25), (1.4, 1.5), (1.0, 1.9), (-1.0, 1.9), (-1.4, 1.5), (-1.4, -1.25)], -7.5, 5.6)
bevel(body, 0.06, 2)
cut(body, [box('panel', None, (s * 1.46, -0.5, -2.4), (0.26, 0.9, 7.8)) for s in (-1, 1)])
cut(body, [box('port', None, (1.1, 0.95, -2.3), (1.3, 0.78, 2.4))], dark=True)
# The slot runs back far enough for the whole travel of the handle.
cut(body, [box('slot', None, (-1.5, 1.25, (-5.5 + CH_Z + TRAVEL + 0.2) / 2), (0.5, 0.3, CH_Z + TRAVEL + 0.2 + 5.5))], dark=True)
# The trough the tube magazine lies in, with the feed slot up to the bolt.
cut(body, [rod('trough', None, (0, MAG_Y, -7.7), (0, MAG_Y, -0.28), 1.56, seg=32)], mat='inner')
cut(body, [box('feed', None, (0, -0.3, -1.7), (0.8, 1.2, 1.9))], dark=True)
fix(body)
# Chamber in the port, uncovered when the bolt goes back: the breech ring and the hole in it.
breech = rod('breech', 'bright', (0.9, 0.95, -3.45), (0.9, 0.95, -3.2), 0.34, seg=14)
cut(breech, [rod('breech-hole', None, (0.9, 0.95, -3.35), (0.9, 0.95, -3.0), 0.2, seg=12)], dark=True)
fix(breech, 40)
BOLT = (0, 1.1, CH_Z)
with moving('bolt', BOLT):
	# Bolt face in the port, with the extractor groove.
	bolt = box('bolt', 'bright', (0.92, 0.95, -2.3), (0.9, 0.66, 2.3))
	cut(bolt, [box('groove', None, (1.4, 0.95, -2.3), (0.2, 0.12, 2.5))], dark=True)
	part(bolt, 0.025, 1)
	# Charging handle: stem in the slot, a knob with a grip groove.
	part(rod('ch-stem', 'steel', (-1.25, 1.25, -1.9), (-1.95, 1.25, -1.9), 0.13, seg=10), 0.02, 1)
	knob = lathe('ch-knob', 'steel', [(0, 0), (0.3, 0), (0.34, -0.08), (0.34, -0.2), (0.28, -0.25), (0.28, -0.33), (0.34, -0.38), (0.34, -0.5), (0.28, -0.58), (0, -0.58)], (-1.85, 1.25, -1.9), 'x', seg=16)
	fix(knob, 40)
# Pins through the lower receiver, rivets on the side panels.
for y, z in [(-1.0, 1.3), (-0.95, 4.7)]:
	part(rod('pin', 'bright', (-1.46, y, z), (1.46, y, z), 0.14, seg=8, phase=math.pi / 8))
# The front one only has heads: the magazine passes between them.
for s in (-1, 1):
	part(rod('pin', 'bright', (s * 1.385, -1.0, -6.7), (s * 1.46, -1.0, -6.7), 0.14, seg=8, phase=math.pi / 8))
for s in (-1, 1):
	for z in (-6.7, -4.4, 0.4):
		part(rod('rivet', 'steel', (s * 1.36, 0.25, z), (s * 1.47, 0.25, z), 0.1, seg=8), 0.02, 1)
# Selector on the left above the grip: hub and lever.
part(rod('sel-hub', 'steel', (-1.38, -0.75, 3.0), (-1.56, -0.75, 3.0), 0.3, seg=16), 0.03, 1)
part(box('sel-lever', 'steel', (-1.55, -0.95, 2.55), (0.1, 0.26, 1.0), ('x', -0.45)), 0.025, 1)

strap = section('top-strap', 'steel', [(-0.75, 1.85), (0.75, 1.85), (0.75, 2.1), (0.6, 2.25), (-0.6, 2.25), (-0.75, 2.1)], -6.15, 3.7)
bevel(strap, 0.03, 1)
cut(strap, [box('ser%d' % i, None, (0, 2.3, -5.65 + i * 0.45), (2.0, 0.16, 0.17)) for i in range(20)])
fix(strap)

cap = section('end-cap', 'polymer', [(-1.1, -1.45), (1.1, -1.45), (1.35, -1.2), (1.35, 1.45), (0.95, 1.85), (-0.95, 1.85), (-1.35, 1.45), (-1.35, -1.2)], 5.55, 6.2)
part(cap, 0.09, 2)
# Recoil buffer: a turned steel cap in the rear face, held by two screws.
part(lathe('buffer', 'steel', [(0, 0), (0.72, 0), (0.72, 0.12), (0.62, 0.2), (0.3, 0.22), (0.3, 0.27), (0, 0.27)], (0, 0.25, 6.15), 'z', seg=24))
for x in (-0.95, 0.95):
	screw('cap-screw', (x, 1.25, 6.15), (x, 1.25, 6.26), 0.12)
# Rear sling loop on the left of the cap.
part(box('loop-base', 'steel', (-1.42, 0.9, 5.9), (0.2, 0.5, 0.42)), 0.03, 1)
part(torus('rear-loop', 'bright', (-1.72, 0.9, 5.9), 'y', 0.3, 0.075, seg=14, sides=6))

# ---------------------------------------------------------------------
# Sights: a rear aperture leaf between two ears on the back of the strap, a
# post in a round hood on the front of the receiver. Aperture centre and post tip are level.

part(section('rear-base', 'steel', [(-0.95, 2.1), (0.95, 2.1), (0.95, 2.35), (0.75, 2.55), (-0.75, 2.55), (-0.95, 2.35)], REAR_Z - 0.6, REAR_Z + 0.6), 0.04)
# The leaf has a U notch open to the top: the view over the front post stays clear when aimed.
leaf = box('leaf', 'steel', (0, (2.45 + SIGHT_Y + 0.42) / 2, REAR_Z), (1.2, SIGHT_Y + 0.42 - 2.45, 0.24))
cut(leaf, [box('notch-top', None, (0, SIGHT_Y + 0.5, REAR_Z), (0.56, 1.0, 0.6))])
cut(leaf, [rod('notch', None, (0, SIGHT_Y, REAR_Z - 0.3), (0, SIGHT_Y, REAR_Z + 0.3), 0.28, seg=20)])
part(leaf, 0.03, 1)
for s in (-1, 1):
	ear = side('ear', 'steel', [(REAR_Z - 0.5, 2.45), (REAR_Z + 0.55, 2.45), (REAR_Z + 0.4, SIGHT_Y + 0.3), (REAR_Z + 0.05, SIGHT_Y + 0.5), (REAR_Z - 0.35, SIGHT_Y + 0.3)], s * 0.62, s * 0.9)
	part(ear, 0.04, 2)
part(rod('windage', 'bright', (0.95, 2.32, REAR_Z), (1.1, 2.32, REAR_Z), 0.16, seg=12), 0.02, 1)

part(section('front-base', 'steel', [(-0.68, 1.85), (0.68, 1.85), (0.5, 2.62), (-0.5, 2.62)], POST_Z + 0.55, POST_Z - 0.55), 0.05)
# The hood is a half ring round the post, open on top, so the view over the post stays clear when aimed.
hood = ring('hood', 'steel', (0, SIGHT_Y - 0.15, POST_Z), 'z', 0.62, 0.48, 0.72, seg=24)
cut(hood, [box('hood-top', None, (0, SIGHT_Y + 0.5, POST_Z), (2.0, 1.3, 1.2))])
part(hood, 0.03, 1)
part(side('post', 'steel', [(POST_Z - 0.1, 2.55), (POST_Z + 0.22, 2.55), (POST_Z + 0.06, SIGHT_Y), (POST_Z - 0.1, SIGHT_Y)], -0.1, 0.1), 0.015, 1)

# ---------------------------------------------------------------------
# Barrel: a perforated shroud out of the receiver, the bare barrel, a band
# that ties it to the magazine, the muzzle nut (grooved, crowned, the bore).

shroud = rod('shroud', 'steel', (0, BORE_Y, -7.45), (0, BORE_Y, -10.5), 0.95, seg=28)
bevel(shroud, 0.04, 1)
holes = []
for ang in (30, 90, 150):
	a = math.radians(ang)
	for i, z in enumerate((-8.05, -8.85, -9.65)):
		holes.append(rod('hole', None, (0.5 * math.cos(a), BORE_Y + 0.5 * math.sin(a), z), (1.3 * math.cos(a), BORE_Y + 1.3 * math.sin(a), z), 0.22, seg=8, phase=math.pi / 8))
cut(shroud, holes, dark=True)
fix(shroud, 40)
part(rod('barrel', 'steel', (0, BORE_Y, -10.4), (0, BORE_Y, -11.95), 0.52, seg=20))
muzzle = lathe('muzzle', 'steel', [(0, 0), (0.8, 0), (0.8, -0.24), (0.7, -0.31), (0.7, -0.41), (0.8, -0.48), (0.8, -0.72), (0.7, -0.79), (0.7, -0.89), (0.8, -0.96), (0.8, -1.24), (0.68, -1.42), (0, -1.42)], (0, BORE_Y, -11.85), 'z', seg=28)
cut(muzzle, [rod('bore', None, (0, BORE_Y, -13.6), (0, BORE_Y, -12.6), 0.3, seg=16)], dark=True)
fix(muzzle, 40)

# The band, split at the axis of the magazine: the upper half on the barrel, the lower half on the magazine.
def band(lower):
	b = section('band', 'steel', hull(circle(0, BORE_Y, 1.02) + circle(0, MAG_Y, 1.6, 28)), -10.45, -11.05)
	bevel(b, 0.05)
	cut(b, [box('band-half', None, (0, MAG_Y + (2.5 if lower else -2.5), -10.75), (6, 5, 2))])
	if not lower:
		cut(b, [rod('band-seat', None, (0, MAG_Y, -10.0), (0, MAG_Y, -11.5), 1.51, seg=32)], mat='inner')
	fix(b)
band(False)
with moving('mag', (0, MAG_Y, -0.4)):
	band(True)
screw('band-screw', (1.55, -0.6, -10.75), (1.68, -0.6, -10.75), 0.13)
part(torus('front-loop', 'bright', (-1.72, -0.75, -10.75), 'z', 0.3, 0.075, seg=14, sides=6))

# ---------------------------------------------------------------------
# Tube magazine under the barrel: its rear just ahead of the trigger guard,
# a window on the left showing the cases, the latch under the rear ring, the
# front cap. The handguard (where the left hand holds) wraps its lower half.

with moving('mag', (0, MAG_Y, -0.4)):
	tube = lathe('magazine', 'polymer', [(0, 0), (1.38, 0), (1.5, -0.12), (1.5, -11.0), (0, -11.0)], (0, MAG_Y, -0.4), 'z', seg=32)
	cut(tube, [box('window', None, (-1.5, MAG_Y, -1.75), (0.5, 0.4, 1.7))], dark=True)
	# Feed mouth on top, under the feed slot of the receiver, with a round in it.
	cut(tube, [box('mouth', None, (0, MAG_Y + 1.45, -1.7), (0.7, 0.7, 1.7))], mat='inner')
	fix(tube, 40)
	for z in (-2.35, -1.95, -1.55, -1.15):
		part(rod('case', 'brass', (-1.28, MAG_Y - 0.19, z), (-1.28, MAG_Y + 0.19, z), 0.17, seg=10))
	part(lathe('mag-ring', 'steel', [(0, 0), (1.5, 0), (1.58, -0.06), (1.58, -0.36), (1.5, -0.42), (0, -0.42)], (0, MAG_Y, -0.3), 'z', seg=32))
	part(lathe('mag-cap', 'steel', [(0, 0), (1.52, 0), (1.56, -0.06), (1.56, -0.3), (1.44, -0.48), (0.7, -0.56), (0, -0.56)], (0, MAG_Y, -11.35), 'z', seg=32))
	part(rod('cap-button', 'bright', (0, MAG_Y - 0.55, -11.85), (0, MAG_Y - 0.55, -12.0), 0.26, seg=12), 0.02, 1)
	part(box('mag-latch', 'steel', (0, MAG_Y - 1.58, -0.65), (0.7, 0.3, 0.75)), 0.04, 1)
	part(rod('latch-pin', 'bright', (-0.38, MAG_Y - 1.5, -0.4), (0.38, MAG_Y - 1.5, -0.4), 0.08, seg=8), 0.01, 1)

	A0 = math.degrees(math.asin(0.6 / 1.72))
	arc = [math.radians(A0 - (180 + 2 * A0) * i / 26) for i in range(27)]
	hg = section('handguard', 'polymer', [(1.72 * math.cos(a), MAG_Y + 1.72 * math.sin(a)) for a in arc], -2.8, -10.0)
	bevel(hg, 0.07, 1)
	cut(hg, [lathe('hg-groove', None, [(1.62, 0), (2.2, 0), (2.2, -0.22), (1.62, -0.22)], (0, MAG_Y, z), 'z', seg=32, closed=True) for z in (-4.0, -4.9, -5.8, -6.7, -7.6, -8.5)])
	fix(hg)
	for s in (-1, 1):
		for z in (-3.3, -9.5):
			screw('hg-screw', (s * 1.62, -2.2, z), (s * 1.74, -2.2, z), 0.12)
	cartridge('feed-round', (0, MAG_Y + 1.3, -0.95), 1.45, 0.24)

# ---------------------------------------------------------------------
# Trigger guard just behind the magazine, the trigger, the pistol grip with
# finger grooves and inset rubber panels.

gz, gy = GRIP
guard = side('guard', 'polymer', [(-0.3, -1.4), (-0.1, -3.0), (2.3, -3.25), (3.15, -2.7), (2.75, -1.4)], -0.4, 0.4)
cut(guard, [side('guard-hole', None, [(0.15, -1.3), (0.32, -2.68), (2.2, -2.88), (2.62, -2.55), (2.4, -1.3)], -1, 1)])
part(guard, 0.06)
with moving('trigger', (0, -1.5, 1.2)):
	part(side('trigger', 'bright', [(1.0, -1.45), (1.38, -1.45), (1.5, -2.05), (1.36, -2.62), (1.2, -2.6), (1.28, -2.05)], -0.15, 0.15), 0.03, 1)

def front(y):
	return gz + 0.326 * (gy - y)
grip = side('grip', 'polymer', [(gz, gy), (front(-2.7), -2.7), (front(-3.05) + 0.14, -3.05), (front(-3.45), -3.45), (front(-3.95) + 0.14, -3.95), (front(-4.45), -4.45), (front(-4.95) + 0.14, -4.95), (front(-5.5), -5.5),
	(front(-5.85) - 0.05, -5.85), (front(-6.1) + 0.1, -6.15), (6.35, -6.15), (6.5, -5.85), (5.4, -2.3), (5.45, -1.95), (5.75, -1.45)], -1.0, 1.0)
part(grip, 0.13, 2)
for s in (-1, 1):
	part(side('grip-panel', 'rubber', [(3.25, -2.4), (3.95, -5.55), (5.95, -5.55), (5.2, -2.4)], s * 0.9, s * 1.08), 0.035, 2)
	screw('panel-screw', (s * 1.04, -4.0, 4.6), (s * 1.15, -4.0, 4.6), 0.14)

# ---------------------------------------------------------------------
# Wire stock folded forward along the right side: hinge at the rear, two
# struts, the butt plate and its rubber pad beside the front of the receiver.

part(box('hinge-block', 'steel', (1.5, -0.25, 5.75), (0.55, 2.2, 0.95)), 0.05)
part(rod('hinge-pin', 'bright', (1.85, -1.45, 5.75), (1.85, 1.05, 5.75), 0.2, seg=12), 0.02, 1)
for y in (0.5, -1.0):
	part(rod('strut', 'steel', (1.85, y, 5.75), (1.85, y, -4.65), 0.17, seg=10))
	part(rod('strut-knuckle', 'steel', (1.85, y, 6.05), (1.85, y, 5.45), 0.27, seg=12), 0.03, 1)
part(box('butt-plate', 'steel', (1.92, -0.25, -4.75), (0.55, 2.9, 0.42)), 0.05)
pad = box('butt-pad', 'rubber', (1.92, -0.25, -5.17), (0.62, 3.0, 0.45))
bevel(pad, 0.08, 2)
cut(pad, [box('pad-groove', None, (1.92, y, -5.42), (0.8, 0.16, 0.2)) for y in (0.75, 0.15, -0.45, -1.05)])
fix(pad)

# ---------------------------------------------------------------------
# Points: where a case leaves, the seat of the magazine (it goes out along -Y
# here), where the hands take hold.

point('eject', (1.42, 0.95, -2.3), (0, 0, 0.35))
point('magwell', (0, MAG_Y, -0.4))
point('grip_mag', (0, MAG_Y - 1.72, -6.2), under='mag')
point('grip_bolt', (-2.15, 1.25, CH_Z), under='bolt')
point('hand_r', (0, -3.8, 4.5), (-0.31, 0, 0))
point('hand_l', (0, MAG_Y - 1.72, -6.2))

# ---------------------------------------------------------------------
# The grip and fore-end where the code-built ones hold them, the sight line
# from the middle of the rear aperture over the tip of the front post.

finish(fit=dict(grip=(0, -3.8, 4.5), fore=(0, MAG_Y - 1.72, -6.2), sight=(0, SIGHT_Y, REAR_Z), front=(0, SIGHT_Y, POST_Z)), budget='plain', wear=dict(edge=1.6, grime=2.0, vary=1.6, radius=0.12))
