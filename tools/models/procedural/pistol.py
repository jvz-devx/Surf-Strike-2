"""
Pistol, first-person model: build.sh pistol (README.md in this folder).

A full-size service pistol, built in the model units of the code-built pistol
(apps/web/src/lib/render/viewmodels.ts, pistol): the bore along -Z on y = 2.05,
the muzzle at z = -8.87, the grip, trigger guard, rail, magazine base and sights
where the code-built ones are, so the hand, the fallback and the pistol other
players hold line up. Squared steel slide with front and rear serrations, the
ejection port over the barrel hood, a notch rear sight and a post front sight
level with each other; a polymer frame with a rail under the dust cover, a
stippled grip, the trigger guard, slide stop, pins and the magazine base plate.

Moving parts: the slide (over the barrel and the hood, which stay with the
frame), the magazine (out of the grip, along its rake) and the trigger. What
they uncover is modelled: the barrel in the hollow slide, the breech face and
the chamber, the trough in the frame, the well with the rounds in the magazine.
common.py does the rest: one texture set, the GLB in asset space.
"""
import os, sys, math
sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

ID = 'pistol'

# Layout of the code-built model (model units).
BORE_Y = 2.05
MUZZLE_Z = -8.87
SLIDE_Z = (-8.78, 1.95)   # front and rear face of the slide
SW = 0.92                 # half width of the slide
TRAVEL = 3.0              # how far the slide goes back (render/gun-rig.ts)
RAKE = 0.308              # the magazine and its well lean back with the grip
SLIDE_Y = (1.02, 3.1)     # bottom and top of the slide
SIGHT_Y = 3.47            # top of the rear sight ears and of the front post: a level sight line
NOTCH_Y = 3.25            # floor of the rear notch
REAR_Z = (0.95, 1.7)      # rear sight, front and back face
POST_Z = (-7.98, -7.3)    # front post, foot front and back
FW = 0.85                 # half width of the frame (dust cover)
GW = 0.9                  # half width of the grip

start(ID, 'pistol', BORE_Y, MUZZLE_Z, surfaces={
	# Parkerised slide: a dark, matte grey steel that wears to bright metal on the edges.
	# Not very metallic, base or worn: the first-person room reflection is dark, so a metallic edge would read dark.
	'steel': dict(SURF['steel'], base=(0.34, 0.345, 0.355), metal=0.35, rough=0.52, wear=(0.84, 0.85, 0.86), wmetal=0.55, wrough=0.28),
	# The barrel hood in the port and the crown: polished, lighter than the slide.
	'barrel': dict(SURF['bright'], base=(0.44, 0.445, 0.45), metal=0.85, rough=0.34),
	# Black polymer frame; the stippled grip a little rougher.
	'polymer': dict(SURF['polymer'], base=(0.155, 0.16, 0.165), rough=0.62, wear=(0.42, 0.425, 0.43)),
	'grip': dict(SURF['polymer'], base=(0.15, 0.153, 0.157), rough=0.78, wear=(0.3, 0.303, 0.307), wrough=0.6),
	# Light sight inserts, so the post and the notch read against a dark target.
	'insert': dict(SURF['dark'], base=(0.86, 0.87, 0.84), metal=0.0, rough=0.45, wear=(0.86, 0.87, 0.84), wmetal=0.0, wrough=0.45),
})

# ---------------------------------------------------------------------
# Slide: squared section with chamfered top edges; the nose chamfered top and
# bottom; bevelled, then the ejection port, the serrations and the holes cut.

with moving('slide', (0, BORE_Y, SLIDE_Z[1])):
	z0, z1 = SLIDE_Z
	BREECH_Z = -1.52   # breech face
	y0, y1 = SLIDE_Y
	slide = section('slide', 'steel', [(-SW, y0 + 0.06), (-SW + 0.06, y0), (SW - 0.06, y0), (SW, y0 + 0.06),
		(SW, y1 - 0.3), (SW - 0.28, y1), (-SW + 0.28, y1), (-SW, y1 - 0.3)], z0, z1)
	cut(slide, [side('nose-top', None, [(z0 - 0.1, y1 + 0.1), (z0 - 0.1, y1 - 0.42), (z0 + 0.62, y1 + 0.1)], -2, 2),
		side('nose-bottom', None, [(z0 - 0.1, y0 - 0.1), (z0 - 0.1, y0 + 0.3), (z0 + 0.42, y0 - 0.1)], -2, 2)])
	bevel(slide, 0.045, 2)
	# Ejection port: over the top and down the right side.
	cut(slide, [box('port', None, (0.53, 2.95, -2.78), (1.95, 1.2, 2.45))], dark=True)
	# Muzzle end: the barrel and the guide rod in their holes.
	cut(slide, [rod('barrel-hole', None, (0, BORE_Y, z0 - 0.2), (0, BORE_Y, z0 + 1.2), 0.5, seg=24),
		rod('rod-hole', None, (0, 1.3, z0 - 0.2), (0, 1.3, z0 + 1.2), 0.2, seg=16)], dark=True)
	# Hollow from below, from behind the nose to the breech face: the barrel runs in it, the port opens into it.
	cut(slide, [box('cavity', None, (0, 1.6, (z0 + 1.08 + BREECH_Z) / 2), (1.15, 1.7, BREECH_Z - z0 - 1.08))], mat='inner')
	# Front and rear serrations on both sides: V grooves (a box turned 45 degrees about the vertical).
	ser = []
	for s in (-1, 1):
		for z in [-7.7 + i * 0.2 for i in range(5)] + [-0.08 + i * 0.2 for i in range(8)]:
			ser.append(box('ser', None, (s * (SW + 0.03), 2.06, z), (0.12, 1.12, 0.12), ('y', math.pi / 4)))
	# Notch for the slide stop, left, at the bottom edge.
	ser.append(box('stop-notch', None, (-SW, y0 + 0.09, -0.82), (0.3, 0.2, 0.52)))
	cut(slide, ser)
	fix(slide)
	# Back plate on the rear face, extractor on the right of the port.
	part(box('back-plate', 'steel', (0, 1.9, z1 + 0.01), (0.52, 0.66, 0.035)), 0.012, 1)
	part(box('extractor', 'steel', (SW + 0.02, 2.5, -1.0), (0.06, 0.26, 1.15)), 0.015, 1)
	part(rod('extractor-pin', 'barrel', (SW, 2.18, -0.7), (SW + 0.05, 2.18, -0.7), 0.07, seg=8))

# Barrel and hood (polished): they stay with the frame. The hood fills the port, its rear face has the chamber;
# its right top corner is chamfered so it stays inside the slide that passes over it. Crown, guide rod.
part(rod('barrel', 'barrel', (0, BORE_Y, -8.45), (0, BORE_Y, -3.9), 0.47, seg=20))
hood = section('hood', 'barrel', [(-0.51, 1.6), (0.85, 1.6), (0.85, 2.7), (0.6, 2.98), (-0.51, 2.98)], -4.08, -1.56)
bevel(hood, 0.04, 1)
cut(hood, [rod('chamber', None, (0, 2.0, -2.6), (0, 2.0, -1.2), 0.33, seg=14)], dark=True)
fix(hood, 40)
crown = lathe('crown', 'barrel', [(0.0, 0.32), (0.47, 0.32), (0.47, -0.2), (0.43, -0.27), (0.0, -0.27)], (0, BORE_Y, -8.6), 'z', seg=28, closed=False)
cut(crown, [rod('bore', None, (0, BORE_Y, -9.0), (0, BORE_Y, -8.5), 0.21, seg=20)], dark=True)
fix(crown, 40)
part(rod('guide-rod', 'barrel', (0, 1.3, -4.6), (0, 1.3, -8.72), 0.14, seg=12), 0.02, 1)

# ---------------------------------------------------------------------
# Sights: a notch rear sight in a dovetail at the back of the slide, a post at
# the front. Ear tops and post tip are level (SIGHT_Y): aimed, the post fills
# the notch to the top of the ears with light on both sides.

with moving('slide', (0, BORE_Y, SLIDE_Z[1])):
	r0, r1 = REAR_Z
	rear = section('rear-sight', 'steel', [(-0.7, 3.0), (0.7, 3.0), (0.7, 3.3), (0.6, SIGHT_Y), (0.21, SIGHT_Y), (0.21, NOTCH_Y),
		(-0.21, NOTCH_Y), (-0.21, SIGHT_Y), (-0.6, SIGHT_Y), (-0.7, 3.3)], r0, r1)
	cut(rear, [side('rear-slope', None, [(r0 - 0.1, 3.28), (r0 - 0.1, 3.6), (r0 + 0.32, 3.6)], -1, 1)])
	part(rear, 0.025, 1)
	for s in (-1, 1):
		part(rod('rear-dot', 'insert', (s * 0.41, 3.36, r1 - 0.02), (s * 0.39, 3.36, r1 + 0.015), 0.055, seg=10))
	p0, p1 = POST_Z
	post = side('front-post', 'steel', [(p0, 3.0), (p1, 3.0), (p1 - 0.06, SIGHT_Y), (p0 + 0.3, SIGHT_Y)], -0.13, 0.13)
	part(post, 0.02, 1)
	part(rod('front-dot', 'insert', (0, 3.32, p1 - 0.08), (0, 3.32, p1 - 0.025), 0.065, seg=10))

# ---------------------------------------------------------------------
# Frame: dust cover with the accessory rail, the beavertail behind the slide,
# the grip, the trigger guard, controls and pins.

frame = side('frame', 'polymer', [(-7.75, 1.06), (-7.75, 0.6), (-7.5, 0.28), (2.4, 0.28), (3.05, -0.05), (3.28, 0.3),
	(3.5, 0.6), (3.47, 0.84), (3.12, 0.98), (2.1, 1.06)], -FW, FW)

def on_mag(s, dz=0.0):
	"""Point on the axis of the magazine: s up it from the middle of the grip."""
	return (0, -2.3 + s * math.cos(RAKE), 2.19 - s * math.sin(RAKE) + dz)
def well(name):
	return box(name, None, on_mag(0.6), (1.2, 8.6, 1.46), ('x', -RAKE))
# The trough the barrel and the guide rod lie in, the top of the magazine well.
cut(frame, [box('trough', None, (0, 1.1, -4.9), (1.1, 0.8, 4.8))], mat='inner')
cut(frame, [well('frame-well')], mat='inner')
part(frame, 0.06, 2)
rail = section('rail', 'polymer', [(-0.62, 0.32), (0.62, 0.32), (0.62, 0.12), (0.74, 0.02), (0.74, -0.06), (0.6, -0.14),
	(-0.6, -0.14), (-0.74, -0.06), (-0.74, 0.02), (-0.62, 0.12)], -7.55, -4.4)
bevel(rail, 0.025, 1)
cut(rail, [box('rail-slot', None, (0, -0.12, z), (2.0, 0.24, 0.3)) for z in (-6.95, -5.95, -4.95)])
fix(rail)

grip = side('grip', 'polymer', [(0.2, 0.3), (0.45, -0.2), (0.62, -0.75), (1.0, -2.0), (1.4, -3.3), (1.72, -4.3), (1.86, -4.98),
	(4.55, -4.98), (4.5, -4.5), (4.2, -3.5), (3.75, -2.2), (3.4, -1.0), (3.1, -0.1), (3.0, 0.3)], -GW, GW)
cut(grip, [rod('lanyard', None, (-1.2, -4.62, 4.12), (1.2, -4.62, 4.12), 0.13, seg=12)], dark=True)
cut(grip, [well('grip-well')], mat='inner')
part(grip, 0.1, 2)

def inside(pt, poly):
	"""Whether the point (z, y) is inside the polygon [(z, y), ...]."""
	z, y = pt
	n = len(poly)
	hit = False
	for i in range(n):
		(za, ya), (zb, yb) = poly[i], poly[(i + 1) % n]
		if (ya > y) != (yb > y) and z < za + (y - ya) * (zb - za) / (yb - ya):
			hit = not hit
	return hit

def stipple(name, mat, x, sign, panel, pitch=0.2, size=0.16, h=0.05):
	"""Grip texture: small four-sided pyramids on the flat side x, pointing out (sign), in rows inside the panel."""
	bm = bmesh.new()
	zs = [p[0] for p in panel]
	ys = [p[1] for p in panel]
	r = size / 2
	row = 0
	y = max(ys) - r
	while y > min(ys) + r:
		z = min(zs) + r + (pitch / 2 if row % 2 else 0)
		while z < max(zs) - r:
			if all(inside(q, panel) for q in ((z - r, y), (z + r, y), (z, y - r), (z, y + r))):
				base = [bm.verts.new(G(x - sign * 0.01, y + dy, z + dz)) for dz, dy in ((-r, 0), (0, -r), (r, 0), (0, r))]
				tip = bm.verts.new(G(x + sign * h, y, z))
				for i in range(4):
					bm.faces.new((base[i], base[(i + 1) % 4], tip))
			z += pitch
		y -= pitch * 0.5
		row += 1
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	return obj(name, bm, mat)

PANEL = [(1.03, -0.9), (3.07, -0.9), (3.45, -2.2), (3.9, -3.5), (4.17, -4.45), (2.06, -4.45), (1.6, -3.3)]
for s in (-1, 1):
	part(stipple('stipple', 'grip', s * GW, s, PANEL), None, angle=20)

# Trigger guard: the opening cut out of the solid bow; squared front.
guard = side('guard', 'polymer', [(-4.1, 0.35), (-4.05, -0.85), (-3.85, -1.35), (-3.45, -1.62), (-0.6, -1.78), (0.25, -1.6),
	(0.75, -1.0), (0.9, -0.5), (0.7, 0.35)], -0.5, 0.5)
cut(guard, [side('guard-hole', None, [(-3.45, 0.45), (-3.42, -0.8), (-3.25, -1.08), (-2.95, -1.2), (-0.6, -1.3), (0.05, -1.15),
	(0.35, -0.75), (0.42, -0.3), (0.3, 0.45)], -1, 1)])
part(guard, 0.06, 2)
# Trigger: a curved blade with a safety blade in its face.
# Far enough back for a finger with a bend in it.
TRIGGER_Z = -0.8
with moving('trigger', (0, 0.2, TRIGGER_Z)):
	part(side('trigger', 'steel', [(TRIGGER_Z + z, y) for z, y in [(-0.2, 0.32), (-0.35, -0.3), (-0.3, -0.75), (-0.1, -1.1), (0.05, -1.12), (-0.03, -0.7),
		(-0.07, -0.3), (0.1, 0.32)]], -0.17, 0.17), 0.04, 2)
	part(side('trigger-blade', 'barrel', [(TRIGGER_Z + z, y) for z, y in [(-0.41, -0.2), (-0.33, -0.2), (-0.29, -0.66), (-0.37, -0.62)]], -0.05, 0.05), 0.01, 1)

# Slide stop on the left: lever with a thumb pad, its pin through the frame.
part(side('slide-stop', 'steel', [(-2.65, 0.72), (-2.35, 0.6), (-1.0, 0.6), (-0.6, 0.66), (-0.42, 0.86), (-0.5, 1.03),
	(-0.92, 1.0), (-2.55, 0.92)], -FW - 0.09, -FW + 0.02), 0.025, 1)
part(rod('stop-pin', 'barrel', (-FW - 0.12, 0.78, -2.45), (FW + 0.03, 0.78, -2.45), 0.1, seg=10))
# Pins through the frame and the takedown tabs ahead of them.
for y, z in ((0.66, -0.1), (0.62, 2.55)):
	part(rod('pin', 'barrel', (-FW - 0.03, y, z), (FW + 0.03, y, z), 0.075, seg=8, phase=math.pi / 8))
for s in (-1, 1):
	part(box('takedown', 'steel', (s * (FW + 0.02), 0.6, -3.15), (0.07, 0.2, 0.62)), 0.015, 1)
# Magazine release behind the trigger guard, left.
part(box('mag-release', 'polymer', (-GW - 0.03, -0.42, 0.78), (0.14, 0.4, 0.34)), 0.04, 2)

# Magazine: a steel box with feed lips, the rounds in it, the base plate under the grip with a finger lip at the front.
SEAT = on_mag(-2.8)
with moving('mag', SEAT):
	tube = box('mag-tube', 'steel', on_mag(0.3), (1.08, 6.1, 1.36), ('x', -RAKE))
	bevel(tube, 0.08, 1)
	cut(tube, [box('mag-mouth', None, on_mag(3.2), (0.72, 1.5, 1.2), ('x', -RAKE))], mat='inner')
	cut(tube, [box('mag-rib', None, (s * 0.56,) + on_mag(0.3)[1:], (0.1, 4.2, 0.2), ('x', -RAKE)) for s in (-1, 1)])
	fix(tube, 40)
	for s, x in ((2.95, 0.0), (2.5, 0.1)):
		p = on_mag(s, 0.58)
		cartridge('round', (x, p[1], p[2]), 1.22, 0.27)
	part(side('base-plate', 'polymer', [(1.82, -4.96), (4.62, -4.96), (4.78, -5.15), (4.7, -5.5), (2.05, -5.5), (1.72, -5.3)], -0.84, 0.84), 0.07, 2)

# ---------------------------------------------------------------------
# Points: where a case leaves, the seat of the magazine (it goes out along -Y
# here), where the hands take hold.

point('eject', (0.92, 2.75, -2.78), (0, 0, 0.6))
point('magwell', SEAT, (-RAKE, 0, 0))
point('grip_mag', (0, -5.5, 3.3), (-RAKE, 0, 0), under='mag')
point('grip_bolt', (0, 2.06, 0.7), under='slide')
point('hand_r', (0, -2.3, 2.45), (-0.3, 0, 0))
point('hand_l', (0, -1.9, 0.95), (-0.3, 0, 0))

# ---------------------------------------------------------------------
# The grip where the code-built one is (the hand closes round its middle), no
# fore-end; the sight line from the notch at ear height over the post tip.

finish(fit=dict(grip=(0, -2.3, 2.45), fore=None, sight=(0, SIGHT_Y, (r0 + r1) / 2), front=(0, SIGHT_Y, (p0 + p1) / 2 + 0.12)), budget='plain',
	wear=dict(edge=2.2, grime=1.4, vary=1.3, width=1.8))
