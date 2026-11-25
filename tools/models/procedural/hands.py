"""
First-person gloved hand with its forearm: build.sh hands (README.md in this folder).

The right hand; the game mirrors it for the left one (render/hands.ts). One
skinned mesh: 17 bones (the hand, the forearm, three per finger, three for
the thumb), so a pair is two draw calls and the knuckles bend without gaps. A
padded glove (knuckle guards, finger pads, side seams, palm panel, wrist strap,
cuff) and a jacket sleeve with a turned-up cuff.

Hand space is three.js: the wrist at the origin, the fingers straight along -Z,
the palm facing -Y, the thumb towards -X, in the model units of the guns. Every
bone is bound without a turn: its axes are the axes of the hand. The numbers in
BONES are the joints; render/hands.ts holds the same table and a test compares it
with the file.
"""
import os, sys, math
sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
from common import *

ID = 'hands'

# Joints: where each bone starts, and what it hangs from.
THUMB_DIR = Vector((-0.66, -0.3, -0.69)).normalized()
THUMB_AT, THUMB_LEN = Vector((-1.25, -0.42, -1.05)), (1.75, 1.45, 1.2)
FINGERS = {  # knuckle, bone lengths, radius at the knuckle and at the tip
	'index': ((-1.66, 0.1, -3.9), (2.05, 1.3, 1.08), 0.5, 0.39),
	'middle': ((-0.56, 0.18, -4.12), (2.25, 1.45, 1.12), 0.52, 0.4),
	'ring': ((0.53, 0.12, -3.92), (2.08, 1.36, 1.1), 0.5, 0.39),
	'pinky': ((1.54, -0.04, -3.45), (1.62, 1.04, 0.98), 0.45, 0.35),
}
BONES = {'hand': ((0, 0, 0), None), 'forearm': ((0, 0, 0.15), 'hand')}
for name, (base, lens, r0, r1) in FINGERS.items():
	z = base[2]
	for i in range(3):
		BONES['%s%d' % (name, i + 1)] = ((base[0], base[1], z), 'hand' if i == 0 else '%s%d' % (name, i))
		z -= lens[i]
p = THUMB_AT.copy()
for i in range(3):
	BONES['thumb%d' % (i + 1)] = (tuple(p), 'hand' if i == 0 else 'thumb%d' % i)
	p = p + THUMB_DIR * THUMB_LEN[i]
SLEEVE_END = 32.0

# The glove and the sleeve in the colours of the code-built hands (render/viewmodels.ts palette: glove, pad, sleeve).
start(ID, 'hands', 0, 0, surfaces={
	'glove': dict(kind='cloth', base=(0.525, 0.44, 0.31), metal=0.0, rough=0.82, wear=(0.66, 0.57, 0.43), wmetal=0.0, wrough=0.7, amount=0.7, bump=('leather', 0.35)),
	# The palm slab: the glove, with a darker panel on the palm side and a seam round it (in the shader).
	'palm': dict(kind='cloth', base=(0.525, 0.44, 0.31), metal=0.0, rough=0.8, wear=(0.66, 0.57, 0.43), wmetal=0.0, wrough=0.66, amount=0.7, bump=('leather', 0.4), panel=(0.84, 0.82, 0.8)),
	'pad': dict(kind='rubber', base=(0.185, 0.197, 0.216), metal=0.0, rough=0.66, wear=(0.36, 0.37, 0.385), wmetal=0.0, wrough=0.5, amount=0.9),
	'strap': dict(kind='cloth', base=(0.17, 0.18, 0.2), metal=0.0, rough=0.85, wear=(0.3, 0.31, 0.33), wmetal=0.0, wrough=0.75, amount=0.6, bump=('weave', 0.25)),
	'sleeve': dict(kind='cloth', base=(0.267, 0.314, 0.37), metal=0.0, rough=0.9, wear=(0.39, 0.435, 0.49), wmetal=0.0, wrough=0.82, amount=0.6, bump=('weave', 0.4)),
	'hem': dict(kind='cloth', base=(0.2, 0.235, 0.28), metal=0.0, rough=0.9, wear=(0.33, 0.37, 0.42), wmetal=0.0, wrough=0.82, amount=0.6, bump=('weave', 0.4)),
})

# Seams and cloth: on top of the shared wear pass, a groove where the 'seam' attribute of the mesh peaks or on the
# seam planes of the palm, and a fine bump (leather grain, or the weave of the sleeve).
_bake_nodes = common.bake_nodes
def _cloth_nodes(mat, p):
	ch = _bake_nodes(mat, p)
	if 'bump' not in p or common.MASK:
		return ch
	nt = mat.node_tree
	N, L = nt.nodes, nt.links
	def new(kind, **values):
		n = N.new(kind)
		for k, v in values.items():
			setattr(n, k, v)
		return n
	def ramp(src, a, b, c, d):
		n = new('ShaderNodeMapRange')
		n.clamp = True
		L.new(src, n.inputs['Value'])
		for k, v in (('From Min', a), ('From Max', b), ('To Min', c), ('To Max', d)):
			n.inputs[k].default_value = v
		return n.outputs['Result']
	def op(kind, a, b):
		n = new('ShaderNodeMath', operation=kind)
		for i, v in enumerate((a, b)):
			if isinstance(v, (int, float)):
				n.inputs[i].default_value = v
			else:
				L.new(v, n.inputs[i])
		return n.outputs[0]
	tc = next(n for n in N if n.bl_idname == 'ShaderNodeTexCoord')
	attr = new('ShaderNodeAttribute', attribute_type='GEOMETRY', attribute_name='seam')
	seam = ramp(attr.outputs['Fac'], 0.82, 0.97, 0.0, 1.0)
	sep = new('ShaderNodeSeparateXYZ')
	L.new(tc.outputs['Object'], sep.inputs['Vector'])
	if 'panel' in p:
		# Round the edge of the hand, just under its middle (Blender z is up), and across the back behind the knuckles and at the wrist.
		def line(v, at, w):
			return op('SUBTRACT', 1.0, ramp(op('ABSOLUTE', op('SUBTRACT', v, at), 0), w * 0.5, w, 0.0, 1.0))
		edge = line(sep.outputs['Z'], -0.2, 0.045)
		seam = op('MAXIMUM', seam, edge)
		seam = op('MAXIMUM', seam, op('MULTIPLY', line(op('ADD', sep.outputs['Y'], op('MULTIPLY', sep.outputs['X'], 0.1)), 3.0, 0.04), ramp(sep.outputs['Z'], 0.0, 0.1, 0.0, 1.0)))
		dark = ramp(sep.outputs['Z'], -0.2, -0.16, 1.0, 0.0)
	# Colour: the groove is darker, with a lighter lip on both sides.
	lip = op('MULTIPLY', ramp(attr.outputs['Fac'], 0.55, 0.75, 0.0, 1.0), op('SUBTRACT', 1.0, seam))
	tone = op('ADD', op('SUBTRACT', 1.0, op('MULTIPLY', seam, 0.45)), op('MULTIPLY', lip, 0.08))
	mix = new('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
	socket(mix, 'Factor_Float').default_value = 1.0
	L.new(ch['color'], socket(mix, 'A_Color'))
	L.new(tone, socket(mix, 'B_Color'))
	ch['color'] = out_socket(mix, 'Result_Color')
	if 'panel' in p:
		mix = new('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
		L.new(dark, socket(mix, 'Factor_Float'))
		L.new(ch['color'], socket(mix, 'A_Color'))
		socket(mix, 'B_Color').default_value = (*p['panel'], 1)
		ch['color'] = out_socket(mix, 'Result_Color')
	# Relief.
	kind, strength = p['bump']
	if kind == 'leather':
		t = new('ShaderNodeTexVoronoi', feature='SMOOTH_F1')
		t.inputs['Scale'].default_value = 7.0
		L.new(tc.outputs['Object'], t.inputs['Vector'])
		height = op('MULTIPLY', t.outputs['Distance'], 0.5)
	else:
		t = new('ShaderNodeTexWave', bands_direction='DIAGONAL')
		t.inputs['Scale'].default_value = 5.0
		t.inputs['Distortion'].default_value = 0.6
		L.new(tc.outputs['Object'], t.inputs['Vector'])
		height = op('MULTIPLY', t.outputs['Fac'], 0.35)
		# Creases: a soft noise, stretched round the arm.
		mp = new('ShaderNodeMapping')
		mp.inputs['Scale'].default_value = (0.5, 1.0, 0.5)
		L.new(tc.outputs['Object'], mp.inputs['Vector'])
		w = new('ShaderNodeTexNoise')
		w.inputs['Scale'].default_value = 1.1
		w.inputs['Detail'].default_value = 2.0
		w.inputs['Distortion'].default_value = 1.2
		L.new(mp.outputs['Vector'], w.inputs['Vector'])
		height = op('ADD', height, op('MULTIPLY', w.outputs['Fac'], 9.0))
	height = op('SUBTRACT', height, op('MULTIPLY', seam, 1.6))
	b = new('ShaderNodeBump')
	b.inputs['Strength'].default_value = strength
	b.inputs['Distance'].default_value = 0.05
	L.new(height, b.inputs['Height'])
	dif = N['diffuse']
	L.new(dif.inputs['Normal'].links[0].from_socket, b.inputs['Normal'])
	L.new(b.outputs['Normal'], dif.inputs['Normal'])
	return ch
common.bake_nodes = _cloth_nodes

# ---------------------------------------------------------------------
# Building blocks: meshes with their bone weights.

def smooth(a, b, x):
	t = min(1, max(0, (x - a) / (b - a)))
	return t * t * (3 - 2 * t)

def skin(o, weights):
	"""Vertex groups from weights(model point) -> {bone: weight}."""
	groups = {}
	for v in o.data.vertices:
		p = Vector((v.co.x, v.co.z, -v.co.y))  # back to model space
		for bone, w in weights(p).items():
			if w <= 0.001:
				continue
			if bone not in groups:
				groups[bone] = o.vertex_groups.new(name=bone)
			groups[bone].add([v.index], w, 'REPLACE')
	return o

def seam_of(o, value=None):
	a = o.data.attributes.get('seam') or o.data.attributes.new('seam', 'FLOAT', 'POINT')
	if value:
		a.data.foreach_set('value', value)
	return o

def loft(name, mat, rings, cap=(True, True), seams=()):
	"""Skin over rings of model points (all of one length); seams: ring indices whose column is a seam line."""
	bm = bmesh.new()
	vs = [[bm.verts.new(G(*p)) for p in ring] for ring in rings]
	n = len(rings[0])
	for a, b in zip(vs, vs[1:]):
		for i in range(n):
			j = (i + 1) % n
			bm.faces.new((a[i], a[j], b[j], b[i]))
	if cap[0]:
		bm.faces.new(list(reversed(vs[0])))
	if cap[1]:
		bm.faces.new(vs[-1])
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	o = obj(name, bm, mat)
	value = [0.0] * len(o.data.vertices)
	for r in range(len(rings)):
		for i in seams:
			value[r * n + i] = 1.0
	return seam_of(o, value)

def done(o, weights, angle=60):
	skin(o, weights)
	if not o.data.attributes.get('seam'):
		seam_of(o)
	part(o, None, angle=angle)
	return o

def pad(name, centre, size, weights, w=0.1, turn=None, mat='pad', seg=2):
	"""Padded piece: a rounded box on one bone."""
	o = box(name, mat, centre, size, turn)
	bevel(o, w, seg)
	seam_of(o)
	skin(o, weights)
	add(o)
	return o

def dome(name, centre, size, weights, mat='pad', n=14, frame=None, e=3.2):
	"""Padded guard: a low cushion, size (across, high, along), its base sunk into the glove."""
	w, h, l = size
	rings = []
	for y, k in ((-0.6, 0.98), (0.0, 1.0), (0.28, 0.95), (0.45, 0.78), (0.5, 0.45)):
		ring = []
		for i in range(n):
			a = 2 * math.pi * i / n
			c, s = math.cos(a), math.sin(a)
			q = Vector((math.copysign(abs(c) ** (2 / e), c) * w / 2 * k, y * h, math.copysign(abs(s) ** (2 / e), s) * l / 2 * k))
			ring.append(tuple(Vector(centre) + (frame @ q if frame is not None else q)))
		rings.append(ring)
	o = loft(name, mat, rings)
	done(o, weights, 75)
	return o

# ---------------------------------------------------------------------
# Fingers: tubes of 12 sides with a ring on each side of every joint, a seam along both sides, flatter under the
# tip. The base reaches into the palm.

SIDES = 12
def tube(bone, origin, axis, up, lens, r0, r1, start, mat='glove', tip=0.9):
	"""Tube along an axis from 'start' (behind the first joint) to the tip, bent at its joints by the bones."""
	side = axis.cross(up).normalized()
	total = sum(lens)
	joints = [0, lens[0], lens[0] + lens[1]]
	stations = [start, 0.0, joints[1] * 0.35, joints[1] * 0.72, joints[1] - 0.3, joints[1], joints[1] + 0.3,
		(joints[1] + joints[2]) / 2, joints[2] - 0.26, joints[2], joints[2] + 0.26, joints[2] + lens[2] * 0.5]
	def radius(s):
		t = min(1, max(0, s / (total - r1)))
		r = r0 + (r1 - r0) * t
		# Fuller between the joints, a crease at each.
		for j in joints[1:]:
			r -= 0.035 * math.exp(-((s - j) / 0.16) ** 2)
		return r
	rings = []
	def ring(s, r, drop=0.0):
		c = origin + axis * s
		out = []
		for i in range(SIDES):
			a = 2 * math.pi * i / SIDES
			y = math.sin(a) * r
			# Flatter pads under the finger.
			y *= 0.94 if y < 0 else 1.0
			q = c + side * (math.cos(a) * r * 0.98) + up * (y - drop)
			out.append(tuple(q))
		rings.append(out)
	for s in stations:
		ring(s, radius(s))
	# Rounded, squarish tip.
	end = total - r1 * tip
	for k in (0.0, 0.45, 0.75, 0.95):
		ring(end + r1 * tip * k, r1 * math.sqrt(max(0.02, 1 - k ** 2.6)), 0.05 * k)
	o = loft(bone, mat, rings, cap=(True, True), seams=(0, SIDES // 2))
	names = ['%s%d' % (bone, i + 1) for i in range(3)]
	def weights(q):
		s = (q - origin).dot(axis)
		w = {}
		a = smooth(-0.35, 0.35, s)        # over the knuckle
		b = smooth(joints[1] - 0.28, joints[1] + 0.28, s)
		c = smooth(joints[2] - 0.24, joints[2] + 0.24, s)
		w['hand'] = 1 - a
		w[names[0]] = a * (1 - b)
		w[names[1]] = b * (1 - c)
		w[names[2]] = c
		return w
	done(o, weights, 80)
	return o

for i, (name, (base, lens, r0, r1)) in enumerate(FINGERS.items()):
	with moving(name, base):
		tube(name, Vector(base), Vector((0, 0, -1)), Vector((0, 1, 0)), lens, r0, r1, -0.75)
		# Padded guards over the first two bones of the finger.
		z = base[2]
		w = r0 * 1.3
		dome(name + '-pad1', (base[0], base[1] + r0 * 0.88, z - lens[0] * 0.52), (w, 0.26, lens[0] * 0.5), lambda q, b=name + '1': {b: 1})
		dome(name + '-pad2', (base[0], base[1] + r0 * 0.8, z - lens[0] - lens[1] * 0.5), (w * 0.86, 0.22, lens[1] * 0.52), lambda q, b=name + '2': {b: 1}, n=12)
		dome(name + '-knuckle', (base[0], base[1] + r0 * (1.22 if name == 'pinky' else 1.02), z + 0.14), (r0 * 1.75, 0.36, 0.98), lambda q, b=name + '1': {'hand': 0.7, b: 0.3}, e=2.8)

THUMB_UP = (Vector((-0.35, 0.93, 0.0)) - THUMB_DIR * Vector((-0.35, 0.93, 0.0)).dot(THUMB_DIR)).normalized()
with moving('thumb', tuple(THUMB_AT)):
	tube('thumb', THUMB_AT, THUMB_DIR, THUMB_UP, THUMB_LEN, 0.6, 0.43, -0.3)
	c = THUMB_AT + THUMB_DIR * (THUMB_LEN[0] + THUMB_LEN[1] * 0.5) + THUMB_UP * 0.46
	side = THUMB_DIR.cross(THUMB_UP).normalized()
	# Model axes of the pad: x across, y up, z back along the thumb.
	frame = Matrix(((side.x, THUMB_UP.x, -THUMB_DIR.x), (side.y, THUMB_UP.y, -THUMB_DIR.y), (side.z, THUMB_UP.z, -THUMB_DIR.z)))
	dome('thumb-pad', tuple(c), (0.62, 0.22, 0.8), lambda q: {'thumb2': 1}, n=12, frame=frame)

# ---------------------------------------------------------------------
# Palm: a lofted slab with the ball of the thumb, the heel and the web of the thumb, merged by a voxel remesh.

def superellipse(cx, cy, z, hw, top, bot, n=24, e=2.8, shear=0.0):
	ring = []
	for i in range(n):
		a = 2 * math.pi * i / n
		c, s = math.cos(a), math.sin(a)
		x = math.copysign(abs(c) ** (2 / e), c) * hw
		y = math.copysign(abs(s) ** (2 / e), s) * (top if s > 0 else bot)
		ring.append((cx + x, cy + y, z + shear * x))
	return ring

# z, centre x, half width, height of the back and depth of the palm, shear (the little-finger side is shorter)
SECTIONS = [(0.75, 0.0, 1.22, 0.72, 0.7, 0), (0.1, 0.0, 1.28, 0.7, 0.68, 0), (-0.6, -0.03, 1.55, 0.72, 0.68, 0), (-1.5, -0.04, 1.9, 0.74, 0.64, 0.02),
	(-2.5, -0.06, 2.08, 0.76, 0.56, 0.06), (-3.3, -0.07, 2.12, 0.74, 0.5, 0.1), (-3.85, -0.07, 2.06, 0.64, 0.46, 0.13), (-4.2, -0.07, 1.86, 0.44, 0.36, 0.14)]
slab = loft('palm', 'glove', [superellipse(x, 0, z, hw, t, b, shear=sh) for z, x, hw, t, b, sh in SECTIONS])
def blob(name, centre, radii, axis=None):
	bm = bmesh.new()
	bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=1)
	bmesh.ops.scale(bm, vec=Vector((radii[0], radii[2], radii[1])), verts=bm.verts)
	if axis is not None:
		q = Vector((0, 1, 0)).rotation_difference(G(*axis).normalized())
		bmesh.ops.rotate(bm, cent=Vector(), matrix=q.to_matrix(), verts=bm.verts)
	bmesh.ops.translate(bm, vec=G(*centre), verts=bm.verts)
	return obj(name, bm, 'glove')
palm = join([slab,
	blob('thenar', tuple(THUMB_AT + THUMB_DIR * 0.75 + Vector((0.18, -0.04, 0.1))), (0.74, 0.7, 1.45), tuple(THUMB_DIR)),
	blob('heel', (1.05, -0.38, -1.4), (0.8, 0.52, 1.5)),
	blob('web', (-1.45, -0.12, -2.75), (0.62, 0.46, 1.05), (-0.25, 0.05, -1))])
m = palm.modifiers.new('remesh', 'REMESH')
m.mode = 'VOXEL'
m.voxel_size = 0.1
m = palm.modifiers.new('smooth', 'SMOOTH')
m.factor = 0.5
m.iterations = 8
apply(palm)
m = palm.modifiers.new('decimate', 'DECIMATE')
m.ratio = 1500 / max(1500, tris(palm))
apply(palm)
palm.data.materials.clear()
palm.data.materials.append(MATS['palm'])
seam_of(palm, [0.0] * len(palm.data.vertices))
def palm_weights(q):
	# The ball of the thumb goes with the first thumb bone; the wrist end with the forearm.
	s = (q - THUMB_AT).dot(THUMB_DIR)
	d = (q - THUMB_AT - THUMB_DIR * max(0, min(THUMB_LEN[0], s))).length
	t = 0.85 * smooth(-0.15, 0.9, s) * (1 - smooth(0.55, 1.15, d))
	f = smooth(0.2, 1.1, q.z)
	return {'hand': (1 - t) * (1 - f), 'thumb1': t * (1 - f), 'forearm': f}
with moving('palm', (0, 0, 0)):
	done(palm, palm_weights, 80)
	# Back of the hand: a padded panel behind the knuckles.
	dome('back-panel', (-0.06, 0.74, -1.95), (2.3, 0.26, 1.35), lambda q: {'hand': 1}, n=18, e=4.0)

# ---------------------------------------------------------------------
# Wrist: the cuff of the glove over the wrist, the strap with its tab.

def ring_at(z, hw, ht, n=20, cy=0.0):
	return superellipse(0, cy, z, hw, ht, ht, n=n, e=2.3)
def wrist_weights(q):
	f = smooth(0.3, 1.6, q.z)
	return {'hand': 1 - f, 'forearm': f}
with moving('cuff', (0, 0, 0)):
	done(loft('cuff', 'glove', [ring_at(z, hw, ht) for z, hw, ht in ((-0.35, 1.36, 0.8), (-0.1, 1.42, 0.86), (0.3, 1.4, 0.9), (0.7, 1.4, 0.95), (1.1, 1.46, 1.02), (1.6, 1.56, 1.14), (2.1, 1.64, 1.24), (2.8, 1.7, 1.3))], cap=(True, True)), wrist_weights, 60)
	# The strap sits on the hand side of the wrist: it doesn't bend with it.
	on_hand = lambda q: {'hand': 1}
	done(loft('strap', 'strap', [ring_at(z, hw, ht) for z, hw, ht in ((-0.46, 1.4, 0.84), (-0.43, 1.52, 0.96), (-0.05, 1.54, 0.99), (0.21, 1.53, 1.0), (0.24, 1.4, 0.88))], cap=(True, True)), on_hand, 50)
	dome('strap-tab', (0.5, 1.02, -0.11), (1.15, 0.16, 0.56), on_hand, mat='strap', n=12, e=5)
	dome('strap-keeper', (-0.4, 1.02, -0.11), (0.3, 0.24, 0.82), on_hand, n=12, e=5)

# Sleeve: a turned-up cuff with its hem, folds, the elbow, the upper sleeve; it runs out of the picture.
def sleeve_ring(z, r, k=0.0, n=18):
	ring = []
	for i in range(n):
		a = 2 * math.pi * i / n
		wob = 1 + k * math.sin(3 * a + z * 1.7) + k * 0.6 * math.sin(5 * a - z * 0.9)
		ring.append((math.cos(a) * r * wob, math.sin(a) * r * 0.86 * wob, z))
	return ring
with moving('sleeve', (0, 0, 2)):
	arm = lambda q: {'forearm': 1}
	done(loft('turn-up', 'sleeve', [sleeve_ring(z, r, 0.012) for z, r in ((2.35, 1.62), (2.05, 1.78), (2.12, 1.94), (2.9, 2.02), (3.7, 2.04), (3.82, 1.96), (3.82, 1.7))]), arm, 45)
	done(loft('hem', 'hem', [sleeve_ring(z, r, 0.012) for z, r in ((2.34, 1.96), (2.36, 2.02), (2.5, 2.035), (2.52, 1.97))]), arm, 45)
	rows = [(3.6, 1.8), (4.0, 1.86), (4.4, 2.0), (4.75, 1.9), (5.3, 1.98), (5.8, 2.12), (6.2, 2.0), (6.9, 2.08), (7.4, 2.2), (7.9, 2.08), (9.0, 2.2), (9.8, 2.34), (10.4, 2.48), (10.9, 2.34), (11.8, 2.44), (12.4, 2.36), (14.0, 2.44), (17.0, 2.52), (23.0, 2.62), (SLEEVE_END, 2.8)]
	done(loft('sleeve', 'sleeve', [sleeve_ring(z, r, 0.022 if i % 2 else 0.035) for i, (z, r) in enumerate(rows)], cap=(True, False)), arm, 70)

# ---------------------------------------------------------------------
# One mesh, its textures, the bones, the file.

TEXEL['sleeve'] = 0.4
gun, tri_piece, LENGTH, TRI = textured('plain', dict(edge=1.2, grime=0.9, vary=1.2, radius=0.1))
me = gun.data
for name in ('piece', 'seam'):
	if name in me.attributes:
		me.attributes.remove(me.attributes[name])
for o in list(bpy.data.objects):
	if o != gun:
		bpy.data.objects.remove(o)
gun.name = me.name = 'glove'
arm = bpy.data.armatures.new('hand-rig')
rig = bpy.data.objects.new('hand-rig', arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.update()
for o in bpy.context.view_layer.objects:
	o.select_set(o == rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, (at, parent) in BONES.items():
	# A bone along Blender's +Z without a roll has the axes of three.js: no turn in the file.
	b = arm.edit_bones.new(name)
	b.head = G(*at)
	b.tail = b.head + Vector((0, 0, 0.4))
	b.roll = 0
	if parent:
		b.parent = arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
gun.parent = rig
mod = gun.modifiers.new('skin', 'ARMATURE')
mod.object = rig
bpy.context.view_layer.update()
print('LENGTH', round(LENGTH, 4))
print('NODES', 'glove', ' '.join(BONES))
if OUT:
	export([rig, gun], TRI, export_skins=True, export_all_influences=False, export_influence_nb=4, export_def_bones=False, export_animations=False, export_rest_position_armature=True)
if RENDERS:
	render(gun, RENDERS)
print('DONE', round(time.time() - T0, 1), 's')
