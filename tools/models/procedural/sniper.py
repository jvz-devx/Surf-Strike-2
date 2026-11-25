"""
Bolt-action sniper rifle, first-person model: build.sh sniper (README.md in this folder).

Built in the model units of the code-built sniper rifle
(apps/web/src/lib/render/viewmodels.ts, sniper): the bore along -Z on y = 0.8,
the muzzle at z = -28.67, the butt at z = +16.3; the grip, the fore-end, the
magazine and the scope axis (y = 3.0, eyepiece at z = 5.1, objective at
z = -9.5) where the code-built ones are. Dark walnut stock, as the rifle other
players see (render/character/held-models.ts), parkerised steel, an anodised scope.
The scope tube is open along its axis (no glass): the scope picture takes over
in the game once fully aimed. The bolt turns up and slides back with its shroud,
handle and knob, the magazine drops out of its well, the trigger turns; the
raceway, the chamber and the top round show then. common.py does the rest.
"""
import os, sys, math
sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
from common import *

ID = 'sniper'

# Layout of the code-built model (model units).
BORE_Y = 0.8
MUZZLE_Z = -28.67
SCOPE_Y = 3.0      # scope axis, level with the bore
EYE_Z = 5.1        # rear face of the eyepiece
OBJ_Z = -9.5       # front face of the objective
TURRET_Z = -2.0
RINGS = (-4.2, 0.7)
GRIP = (0, -3.3, 5.4)      # the right hand closes here, the grip raked back by RAKE
RAKE = 0.42
FORE = (0, -1.5, -9.5)     # under the fore-end, where the left hand cradles it
MAG = (-4.95, -1.95)       # magazine front and back (z)

# Wood grain: a stretched noise along the bore darkens the wood in streaks. A
# surface with grain=<amount> gets it on top of the shared wear pass.
_bake_nodes = common.bake_nodes
EDGE_R = 0.15  # worn-edge band (the shared pass: 0.07), wide enough to read from the hip
def _grain_nodes(mat, p):
	ch = _bake_nodes(mat, p)
	# The edge-mask bevel is the one that feeds the dot product (the other one feeds the normal bake).
	for n in mat.node_tree.nodes:
		if n.bl_idname == 'ShaderNodeBevel' and any(l.to_node.bl_idname == 'ShaderNodeVectorMath' for l in n.outputs['Normal'].links):
			n.inputs['Radius'].default_value = EDGE_R
	g = p.get('grain', 0)
	if not g or common.MASK:
		return ch
	N, L = mat.node_tree.nodes, mat.node_tree.links
	tc = next(n for n in N if n.bl_idname == 'ShaderNodeTexCoord')
	mp = N.new('ShaderNodeMapping')
	mp.inputs['Scale'].default_value = (1.0, 0.07, 1.0)  # Blender Y is the bore
	L.new(tc.outputs['Object'], mp.inputs['Vector'])
	nz = N.new('ShaderNodeTexNoise')
	nz.inputs['Scale'].default_value = 2.4
	nz.inputs['Detail'].default_value = 2.0
	if 'Distortion' in nz.inputs:
		nz.inputs['Distortion'].default_value = 0.8
	L.new(mp.outputs['Vector'], nz.inputs['Vector'])
	mr = N.new('ShaderNodeMapRange')
	mr.clamp = True
	L.new(nz.outputs['Fac'], mr.inputs['Value'])
	mr.inputs['From Min'].default_value = 0.35
	mr.inputs['From Max'].default_value = 0.65
	mr.inputs['To Min'].default_value = 1.0 - g
	mr.inputs['To Max'].default_value = 1.0 + 0.35 * g
	mix = N.new('ShaderNodeMix')
	mix.data_type = 'RGBA'
	mix.blend_type = 'MULTIPLY'
	socket(mix, 'Factor_Float').default_value = 1.0
	L.new(ch['color'], socket(mix, 'A_Color'))
	L.new(mr.outputs['Result'], socket(mix, 'B_Color'))
	ch['color'] = out_socket(mix, 'Result_Color')
	return ch
common.bake_nodes = _grain_nodes

start(ID, 'sniper rifle', BORE_Y, MUZZLE_Z, surfaces={
	# Parkerised steel: darker and flatter than the shared steel, edges worn to bright metal.
	'steel': dict(SURF['steel'], base=(0.235, 0.24, 0.245), rough=0.56, metal=0.6, wear=(0.66, 0.67, 0.68), wrough=0.28),
	# Black anodised scope and rings.
	'scope': dict(SURF['steel'], base=(0.105, 0.108, 0.115), rough=0.42, metal=0.45, wear=(0.48, 0.49, 0.5), wmetal=0.9, wrough=0.26, amount=0.85),
	# Dark walnut, oiled; worn edges turn lighter and smoother.
	'wood': dict(SURF['polymer'], base=(0.31, 0.19, 0.11), rough=0.5, wear=(0.56, 0.39, 0.24), wrough=0.34, amount=1.0, grain=0.22),
	# Chequered panels: the same wood, darker and rough.
	'panel': dict(SURF['rubber'], base=(0.25, 0.152, 0.088), rough=0.82, wear=(0.34, 0.22, 0.13), wrough=0.65, amount=0.1),
})

def knurl(name, mat, c, axis, r1, r2, n, h):
	"""Toothed knob (turret caps, wheels): a star of n teeth between radius r2 and r1,
	length h along 'x' or 'y' through the centre c."""
	pts = []
	for i in range(2 * n):
		a = math.pi * i / n
		r = r1 if i % 2 == 0 else r2
		if axis == 'y':
			pts.append(G(c[0] + r * math.cos(a), c[1] - h / 2, c[2] + r * math.sin(a)))
		else:
			pts.append(G(c[0] - h / 2, c[1] + r * math.cos(a), c[2] + r * math.sin(a)))
	return extrude(name, mat, pts, G(0, h, 0) if axis == 'y' else G(h, 0, 0))

# ---------------------------------------------------------------------
# Stock: one piece of walnut, fore-end, action bed, raked pistol grip and the
# butt with a raised comb; the barrel floats in a channel, the magazine sits in
# a well. Profile (z, y), 2.4 wide, the edges well rounded.

# Grip: front and back edges parallel to its raked axis through GRIP.
ux, uy = -math.sin(RAKE), math.cos(RAKE)          # up the grip (z, y)
px, py = math.cos(RAKE), math.sin(RAKE)           # across it, towards the back
def grip_edge(side, y, hd=1.36):
	z0, y0 = GRIP[2] + side * hd * px, GRIP[1] + side * hd * py
	s = (y - y0) / uy
	return (z0 + s * ux, y)
GRIP_BOTTOM = -5.6
gf_top, gf_bot = grip_edge(-1, -1.6), grip_edge(-1, GRIP_BOTTOM)
gb_bot, gb_top = grip_edge(1, GRIP_BOTTOM), grip_edge(1, -2.55)
stock_prof = [
	(-16.8, 0.32), (-16.8, -1.12), (-15.6, -1.42), (-4.0, -1.6),
	gf_top, gf_bot, gb_bot, gb_top, (7.6, -2.3), (15.45, -3.98),
	(15.45, 1.02), (10.0, 1.22), (8.6, 0.95), (7.2, 0.25), (4.6, 0.2), (3.0, 0.35),
]
stock = side('stock', 'wood', stock_prof, -1.2, 1.2)
bevel(stock, 0.42, 3, 40)
cut(stock, [rod('channel', None, (0, BORE_Y, -6.0), (0, BORE_Y, -17.0), 0.82, seg=24)], dark=True)
cut(stock, [box('well', None, (0, -0.6, (MAG[0] + MAG[1]) / 2), (1.42, 2.4, MAG[1] - MAG[0] + 0.24))], mat='inner')
fix(stock, 40)

# Fore-end tip: black polymer, the channel through it.
tip = side('fore-tip', 'polymer', [(-17.7, 0.28), (-16.74, 0.33), (-16.74, -1.14), (-17.5, -1.0), (-17.7, -0.55)], -1.17, 1.17)
bevel(tip, 0.36, 3, 40)
cut(tip, [rod('tip-channel', None, (0, BORE_Y, -16.0), (0, BORE_Y, -18.2), 0.82, seg=24)], dark=True)
fix(tip, 40)

# Chequered panels: on both sides of the grip and the fore-end, under the fore-end.
for s in (-1, 1):
	gp = []
	for side_, t in ((-1, -1.45), (-1, 1.15), (1, 1.15), (1, -1.45)):
		z0, y0 = GRIP[2] + side_ * 0.62 * px, GRIP[1] + side_ * 0.62 * py
		gp.append((z0 + t * ux, y0 + t * uy))
	part(side('grip-panel', 'panel', gp, s * 1.14, s * 1.215), 0.012, 1)
	part(side('fore-panel', 'panel', [(-14.2, -0.12), (-7.2, -0.12), (-6.8, -0.5), (-7.2, -0.88), (-14.2, -0.82), (-14.6, -0.47)], s * 1.14, s * 1.215), 0.012, 1)
bp = section('belly-panel', 'panel', [(-0.62, -1.52), (0.62, -1.52), (0.66, -1.58), (-0.66, -1.58)], -12.2, -6.9)
part(bp, 0.02, 1)
# The panel rows: shallow cross grooves on the belly (finger grip).
belly = box('belly-ribs', 'panel', (0, -1.6, -9.55), (1.1, 0.06, 5.0))
bevel(belly, 0.015, 1)
cut(belly, [box('rib', None, (0, -1.63, -11.3 + i * 0.7), (1.4, 0.06, 0.2)) for i in range(6)])
fix(belly)

# Grip cap.
gc = side('grip-cap', 'polymer', [(gf_bot[0] - 0.05, GRIP_BOTTOM + 0.12), (gb_bot[0] + 0.05, GRIP_BOTTOM + 0.12), (gb_bot[0] + 0.1, GRIP_BOTTOM - 0.2), (gf_bot[0] + 0.02, GRIP_BOTTOM - 0.2)], -1.16, 1.16)
part(gc, 0.12, 2)

# Cheek rest: a wooden riser over the comb on two steel posts, the height wheel on the left.
riser = side('cheek-rest', 'wood', [(9.3, 1.32), (14.8, 1.13), (14.8, 1.78), (11.0, 1.92), (9.3, 1.7)], -1.05, 1.05)
part(riser, 0.26, 3, 40)
for z in (10.3, 13.7):
	part(rod('riser-post', 'steel', (0, 1.0, z), (0, 1.45, z), 0.13, seg=8))
part(knurl('riser-wheel', 'steel', (-1.36, 0.45, 12.0), 'x', 0.42, 0.37, 14, 0.26))
part(rod('riser-hub', 'steel', (-1.15, 0.45, 12.0), (-1.26, 0.45, 12.0), 0.22, seg=12), 0.015, 1)

# Butt pad: black spacer and rubber pad with grooves down its sides.
part(side('spacer', 'polymer', [(15.38, -3.9), (15.52, -3.9), (15.52, 0.94), (15.38, 0.94)], -1.08, 1.08), 0.06, 1)
pad = side('butt-pad', 'rubber', [(15.5, -3.99), (16.3, -4.05), (16.3, 1.04), (15.5, 1.04)], -1.2, 1.2)
bevel(pad, 0.34, 3, 40)
cut(pad, [box('pad-groove', None, (s * 1.26, y, 15.95), (0.2, 0.12, 0.5)) for s in (-1, 1) for y in (0.0, -1.1, -2.2, -3.3)])
fix(pad)

# Sling studs and loops: under the fore-end and under the butt.
for z, y in ((-14.2, -1.34), (13.4, -3.6)):
	part(rod('stud', 'steel', (0, y + 0.1, z), (0, y - 0.38, z), 0.16, seg=10), 0.02, 1)
	part(torus('swivel', 'bright', (0, y - 0.62, z), 'x', 0.3, 0.06, seg=10, sides=5))
	part(rod('swivel-pin', 'bright', (-0.2, y - 0.3, z), (0.2, y - 0.3, z), 0.07, seg=6))

# ---------------------------------------------------------------------
# Bottom metal: inletted plate with the magazine opening, trigger guard,
# trigger, magazine release, action screws.

plate = section('bottom-metal', 'steel', [(-0.58, -1.47), (0.58, -1.47), (0.58, -1.62), (0.44, -1.7), (-0.44, -1.7), (-0.58, -1.62)], -6.1, 3.0)
cut(plate, [box('plate-well', None, (0, -1.6, (MAG[0] + MAG[1]) / 2), (1.3, 0.5, MAG[1] - MAG[0] + 0.12))], dark=True)
part(plate, 0.03, 1)
# The bow is deep enough for a gloved finger.
guard = side('guard', 'steel', [(-1.2, -1.6), (-0.95, -2.9), (2.2, -3.0), (3.05, -2.2), (2.8, -1.6)], -0.36, 0.36)
cut(guard, [side('guard-hole', None, [(-0.7, -1.5), (-0.52, -2.6), (2.0, -2.71), (2.55, -2.13), (2.35, -1.5)], -1, 1)])
part(guard, 0.05)
with moving('trigger', (0, -1.6, 1.0)):
	part(side('trigger', 'bright', [(0.8, -1.6), (1.18, -1.6), (1.28, -2.05), (1.12, -2.5), (0.94, -2.46), (1.03, -2.03)], -0.16, 0.16), 0.03, 1)
part(box('mag-release', 'steel', (0, -1.92, -1.6), (0.52, 0.5, 0.2), ('x', 0.25)), 0.03, 1)
for z in (-5.65, 2.65):
	screw('action-screw', (0, -1.62, z), (0, -1.78, z), 0.17)

# Detachable box magazine: steel body with pressed ribs and witness holes,
# polymer floor plate with a lip at the front.
SEAT = (0, -1.6, (MAG[0] + MAG[1]) / 2)
with moving('mag', SEAT):
	mz0, mz1 = MAG
	mag = side('magazine', 'steel', [(mz0, -0.25), (mz1, -0.25), (mz1 - 0.08, -3.2), (mz0 + 0.08, -3.2)], -0.6, 0.6)
	bevel(mag, 0.06, 1)
	cut(mag, [box('mag-rib', None, (s * 0.64, -2.35, z), (0.12, 1.1, 0.24)) for s in (-1, 1) for z in (mz0 + 0.75, mz1 - 0.75)])
	cut(mag, [rod('witness', None, (-0.8, y, (mz0 + mz1) / 2), (0.8, y, (mz0 + mz1) / 2), 0.075, seg=8) for y in (-2.0, -2.55)], dark=True)
	fix(mag)
	part(side('mag-floor', 'polymer', [(mz0 - 0.28, -3.12), (mz1 + 0.1, -3.12), (mz1 + 0.02, -3.52), (mz0 - 0.12, -3.52), (mz0 - 0.3, -3.3)], -0.72, 0.72), 0.08, 2)
	# Feed lips and the top round, under the bolt.
	lips = box('mag-lips', 'steel', (0, -0.18, (mz0 + mz1) / 2), (0.84, 0.5, mz1 - mz0 - 0.16))
	cut(lips, [box('mag-mouth', None, (0, 0.0, (mz0 + mz1) / 2), (0.56, 0.5, mz1 - mz0 - 0.4))], mat='inner')
	part(lips)
	cartridge('round', (0, -0.04, mz1 - 0.2), 2.5, 0.23, seg=8)

# ---------------------------------------------------------------------
# Action: round receiver with the ejection port and the bolt handle notch,
# the bolt in the port, bolt shroud, turned-down bolt handle with a long knob,
# safety and bolt release; the scope rail on top.

rcv = lathe('receiver', 'steel', [(0, -6.5), (0.85, -6.5), (0.95, -6.4), (0.95, 2.8), (0.87, 2.9), (0, 2.9)], (0, BORE_Y, 0), 'z', seg=28)
cut(rcv, [box('port', None, (0.95, BORE_Y + 0.26, -1.9), (1.0, 0.95, 2.8))], dark=True)
cut(rcv, [box('handle-notch', None, (0.85, BORE_Y - 0.05, 2.6), (0.8, 0.55, 0.9))], dark=True)
# The raceway, open to the rear; the handle turns up through the notch; the opening over the magazine.
cut(rcv, [rod('raceway', None, (0, BORE_Y, -4.7), (0, BORE_Y, 3.2), 0.64, seg=20)], mat='inner')
cut(rcv, [box('lift', None, (0.65, BORE_Y + 0.7, 2.6), (1.2, 1.1, 0.9))], mat='inner')
cut(rcv, [box('feed', None, (0, 0.0, (MAG[0] + MAG[1]) / 2), (0.92, 0.9, MAG[1] - MAG[0]))], mat='inner')
fix(rcv, 40)
breech = rod('breech', 'bright', (0, BORE_Y, -4.9), (0, BORE_Y, -4.62), 0.63, seg=16)
cut(breech, [rod('chamber', None, (0, BORE_Y, -4.8), (0, BORE_Y, -4.4), 0.28, seg=12)], dark=True)
fix(breech, 40)
with moving('bolt', (0, BORE_Y, 2.55)):
	bolt = rod('bolt', 'bright', (0, BORE_Y, -4.55), (0, BORE_Y, 2.95), 0.6, seg=20)
	cut(bolt, [box('extractor', None, (0.6, BORE_Y + 0.12, -2.3), (0.2, 0.1, 1.4))], dark=True)
	fix(bolt, 40)
	part(lathe('shroud', 'steel', [(0, 2.85), (0.66, 2.85), (0.66, 3.85), (0.56, 4.25), (0.3, 4.42), (0, 4.42)], (0, BORE_Y, 0), 'z', seg=20))
	part(rod('indicator', 'bright', (0, BORE_Y + 0.2, 4.3), (0, BORE_Y + 0.2, 4.5), 0.09, seg=8))
	# Bolt handle: a collar on the bolt, the arm swept back and down, a long tapered knob.
	part(rod('handle-root', 'steel', (0.3, BORE_Y, 2.55), (0.98, BORE_Y - 0.05, 2.58), 0.3, 0.26, seg=14), 0.03, 1)
	part(rod('handle', 'steel', (0.9, BORE_Y - 0.08, 2.58), (2.3, 0.1, 2.74), 0.17, 0.14, seg=10))
	part(rod('knob', 'steel', (2.1, 0.17, 2.72), (2.92, -0.2, 2.8), 0.3, 0.52, seg=14), 0.05, 1)
	part(rod('knob-end', 'steel', (2.9, -0.19, 2.8), (3.16, -0.31, 2.82), 0.52, 0.34, seg=14), 0.05, 1)
# Safety on the right of the tang, bolt release on the left of the receiver.
part(box('safety', 'steel', (0.76, 0.42, 3.75), (0.14, 0.22, 0.6), ('x', -0.25)), 0.03, 1)
part(box('bolt-release', 'steel', (-0.98, 1.05, 2.15), (0.12, 0.28, 0.72)), 0.03, 1)
part(rod('release-pin', 'bright', (-1.06, 1.05, 2.3), (-1.0, 1.05, 2.3), 0.08, seg=6))

# Scope rail on the receiver: bevelled first, then the cross slots, two screws.
rail = section('rail', 'steel', [(-0.5, 1.5), (0.5, 1.5), (0.5, 1.82), (0.62, 1.92), (0.62, 2.0), (0.5, 2.1), (-0.5, 2.1), (-0.62, 2.0), (-0.62, 1.92), (-0.5, 1.82)], -5.8, 2.15)
bevel(rail, 0.02, 1)
cut(rail, [box('rail-slot', None, (0, 2.06, -4.9 + i * 0.85), (1.5, 0.2, 0.3)) for i in range(9)])
fix(rail)
for z in (-5.45, 1.48):
	screw('rail-screw', (0, 2.05, z), (0, 2.14, z), 0.15)

# ---------------------------------------------------------------------
# Barrel: turned, a chamber step and a long taper, six flutes; the muzzle
# brake with three side ports on a jam nut. The brake's face is the muzzle.

def barrel_r(z):
	return 0.62 - 0.1 * (-10.2 - z) / 15.8
bar = lathe('barrel', 'steel', [(0, -6.3), (0.74, -6.3), (0.74, -8.2), (0.62, -10.2), (0.52, -26.0), (0, -26.0)], (0, BORE_Y, 0), 'z', seg=28)
flutes = []
for i in range(6):
	a = math.pi / 6 + i * math.pi / 3
	c, s = math.cos(a), math.sin(a)
	z0, z1 = -11.6, -22.6
	d0, d1 = barrel_r(z0) + 0.08, barrel_r(z1) + 0.08
	flutes.append(rod('flute', None, (d0 * c, BORE_Y + d0 * s, z0), (d1 * c, BORE_Y + d1 * s, z1), 0.17, seg=8))
cut(bar, flutes)
fix(bar, 40)
part(rod('jam-nut', 'steel', (0, BORE_Y, -25.85), (0, BORE_Y, -26.2), 0.66, seg=6, phase=math.pi / 6), 0.03, 1)
brake = lathe('brake', 'steel', [(0, -26.15), (0.6, -26.15), (0.66, -26.28), (0.66, -28.47), (0.56, MUZZLE_Z), (0, MUZZLE_Z)], (0, BORE_Y, 0), 'z', seg=24)
cut(brake, [box('brake-port', None, (0, BORE_Y, z), (2.0, 0.42, 0.34)) for z in (-26.75, -27.33, -27.91)], dark=True)
cut(brake, [rod('bore', None, (0, BORE_Y, -27.0), (0, BORE_Y, MUZZLE_Z - 0.5), 0.2, seg=12)], dark=True)
fix(brake, 40)

# ---------------------------------------------------------------------
# Scope: turned body (objective bell, tube, power ring, eyepiece), open along
# its axis with a dark bore; the turret saddle with elevation, windage and
# focus knobs; two rings on clamp bases.

prof = [(0, OBJ_Z), (1.06, OBJ_Z), (1.1, OBJ_Z + 0.14), (1.1, -8.95), (1.06, -8.9), (1.06, -8.76), (1.1, -8.71),
	(1.1, -7.15), (0.95, -6.6), (0.68, -5.55), (0.62, -5.3), (0.62, 2.1), (0.7, 2.3), (0.74, 2.5),
	(0.79, 2.55), (0.79, 2.8), (0.75, 2.84), (0.75, 2.98), (0.79, 3.02), (0.79, 3.42), (0.76, 3.48), (0.86, 3.7), (0.86, 4.85), (0.82, EYE_Z), (0, EYE_Z)]
scope = lathe('scope', 'scope', prof, (0, SCOPE_Y, 0), 'z', seg=24)
cut(scope, [lathe('scope-bore', None, [(0, OBJ_Z - 0.5), (0.92, OBJ_Z - 0.5), (0.92, OBJ_Z + 0.3), (0.5, OBJ_Z + 0.9),
	(0.5, 4.3), (0.68, 4.7), (0.68, EYE_Z + 0.5), (0, EYE_Z + 0.5)], (0, SCOPE_Y, 0), 'z', seg=24, closed=False)], dark=True)
fix(scope, 35)
part(ring('eyecup', 'rubber', (0, SCOPE_Y, EYE_Z - 0.12), 'z', 0.88, 0.7, 0.24, seg=24))
part(box('throw-lever', 'scope', (0.56, SCOPE_Y + 0.56, 3.0), (0.14, 0.34, 0.5), ('z', -0.78)), 0.03, 1)

sad = box('saddle', 'scope', (0, SCOPE_Y, TURRET_Z), (1.5, 1.5, 1.9))
part(sad, 0.24, 2)
for axis, sx in (('y', 0), ('x', 1)):
	if axis == 'y':
		part(rod('turret-base', 'scope', (0, SCOPE_Y + 0.6, TURRET_Z), (0, SCOPE_Y + 0.95, TURRET_Z), 0.5, seg=20), 0.03, 1)
		part(knurl('turret-cap', 'scope', (0, SCOPE_Y + 1.15, TURRET_Z), 'y', 0.56, 0.51, 18, 0.4))
		part(rod('turret-top', 'scope', (0, SCOPE_Y + 1.35, TURRET_Z), (0, SCOPE_Y + 1.45, TURRET_Z), 0.5, 0.42, seg=20))
	else:
		part(rod('turret-base', 'scope', (0.6, SCOPE_Y, TURRET_Z), (0.95, SCOPE_Y, TURRET_Z), 0.5, seg=20), 0.03, 1)
		part(knurl('turret-cap', 'scope', (1.15, SCOPE_Y, TURRET_Z), 'x', 0.56, 0.51, 18, 0.4))
		part(rod('turret-top', 'scope', (1.35, SCOPE_Y, TURRET_Z), (1.45, SCOPE_Y, TURRET_Z), 0.5, 0.42, seg=20))
# Focus knob on the left: wider and flatter.
part(rod('focus-base', 'scope', (-0.6, SCOPE_Y, TURRET_Z), (-0.85, SCOPE_Y, TURRET_Z), 0.52, seg=20), 0.03, 1)
part(knurl('focus-knob', 'scope', (-1.02, SCOPE_Y, TURRET_Z), 'x', 0.74, 0.69, 22, 0.34))
# Index marks on the turret bases.
part(box('mark', 'bright', (0, SCOPE_Y + 0.8, TURRET_Z - 0.5), (0.06, 0.2, 0.04)))
part(box('mark', 'bright', (0.8, SCOPE_Y, TURRET_Z - 0.5), (0.2, 0.06, 0.04)))

for z in RINGS:
	rg = ring('ring', 'scope', (0, SCOPE_Y, z), 'z', 0.84, 0.6, 0.9, seg=18)
	cut(rg, [box('ring-split', None, (0, SCOPE_Y, z), (2.2, 0.06, 1.2))], dark=True)
	part(rg, 0.03, 1)
	for s in (-1, 1):
		part(box('ring-lug', 'scope', (s * 0.82, SCOPE_Y + 0.02, z), (0.36, 0.5, 0.9)), 0.04, 1)
		for dz in (-0.22, 0.22):
			screw('ring-screw', (s * 0.86, SCOPE_Y + 0.22, z + dz), (s * 0.86, SCOPE_Y + 0.33, z + dz), 0.11, seg=8)
	base = section('ring-base', 'scope', [(-0.66, 2.0), (0.66, 2.0), (0.66, 2.25), (0.42, 2.5), (-0.42, 2.5), (-0.66, 2.25)], z + 0.45, z - 0.45)
	part(base, 0.04, 1)
	part(rod('crossbolt', 'bright', (-0.7, 2.12, z), (0.8, 2.12, z), 0.1, seg=8))
	part(rod('crossbolt-nut', 'steel', (0.66, 2.12, z), (0.86, 2.12, z), 0.2, seg=6, phase=math.pi / 6), 0.02, 1)

# Points: where a case leaves, the seat of the magazine (it goes out along -Y),
# where the hands take hold.
point('eject', (0.95, 1.2, -1.9), (0, 0, 0.5))
point('magwell', SEAT)
point('grip_mag', (0, -3.52, (MAG[0] + MAG[1]) / 2), under='mag')
point('grip_bolt', (2.75, -0.13, 2.8), under='bolt')
point('hand_r', GRIP, (-RAKE, 0, 0))
point('hand_l', FORE)

# The grip and fore-end where the code-built hands hold them; the sight line is
# the scope axis, from the middle of the eyepiece to the middle of the objective.
finish(fit=dict(grip=GRIP, fore=FORE, sight=(0, SCOPE_Y, EYE_Z), front=(0, SCOPE_Y, OBJ_Z)), budget='plain',
	wear=dict(edge=1.9, grime=1.35, vary=1.1))
