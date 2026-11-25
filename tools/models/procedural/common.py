"""
Shared helpers for the script-built first-person guns (README.md in this folder).
Written for Blender 5.3 (bpy, bmesh and the numpy it bundles), run headless by
build.sh. A gun script imports this module, calls start(), builds its parts with
the helpers below in the model units of its code-built gun
(apps/web/src/lib/render/viewmodels.ts) and ends with finish(), which joins,
unwraps, bakes, exports the GLB in asset space and prints the fit data.

Model space is three.js: +X right, +Y up, the bore along -Z. G() turns a model
point into Blender's axes; every helper takes model-space points.
"""
import bpy, bmesh, sys, os, math, time, tempfile
from contextlib import contextmanager
import numpy as np
from mathutils import Vector, Matrix

T0 = time.time()
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else None
OPT = dict(a.split('=', 1) for a in argv[1:] if '=' in a)
RENDERS = OPT.get('renders')

# Size and cost limits of one shipped file: MODEL_BUDGET in render/weapon-assets.ts.
# tex: base colour and normal map size (the roughness/metalness map is half).
BUDGETS = {
	'plain': dict(bytes=300_000, triangles=12_000, tex=1024),
	'detailed': dict(bytes=700_000, triangles=30_000, tex=2048),
}

# PBR values per surface, baked into one texture set; base and wear colours are sRGB.
# kind: how the wear pass treats it (metal, polymer, rubber; none: left alone).
SURF = {
	'steel': dict(kind='metal', base=(0.36, 0.37, 0.38), metal=0.7, rough=0.42, wear=(0.72, 0.73, 0.74), wmetal=0.95, wrough=0.25, amount=1.0),
	'bright': dict(kind='metal', base=(0.5, 0.51, 0.52), metal=0.9, rough=0.32, wear=(0.75, 0.76, 0.77), wmetal=0.95, wrough=0.22, amount=0.8),
	'polymer': dict(kind='polymer', base=(0.19, 0.195, 0.2), metal=0.0, rough=0.6, wear=(0.36, 0.365, 0.37), wmetal=0.0, wrough=0.45, amount=0.8),
	'rubber': dict(kind='rubber', base=(0.15, 0.155, 0.16), metal=0.0, rough=0.8, wear=(0.28, 0.285, 0.29), wmetal=0.0, wrough=0.65, amount=0.5),
	'dark': dict(kind='none', base=(0.045, 0.045, 0.048), metal=0.3, rough=0.6, wear=(0.045, 0.045, 0.048), wmetal=0.3, wrough=0.6, amount=0.0),
	# Machined insides that show when a part moves (wells, raceways, trays): darker than the outside, not black.
	'inner': dict(kind='none', base=(0.13, 0.132, 0.136), metal=0.35, rough=0.5, wear=(0.13, 0.132, 0.136), wmetal=0.35, wrough=0.5, amount=0.0),
	# Cartridge cases.
	'brass': dict(kind='metal', base=(0.56, 0.43, 0.2), metal=0.85, rough=0.34, wear=(0.8, 0.66, 0.38), wmetal=0.95, wrough=0.22, amount=0.6),
}
MATS = {}
PARTS = []
# Moving pieces (moving()): name -> pivot in model space; every part() made inside belongs to the piece. 0 is the body.
PIECES = []
CURRENT = [0]
# Texel density of a piece, as a factor on the rest (1).
TEXEL = {}
# Named points (point()): empties in the file.
POINTS = []
GUN = {}
scene = coll = None

def start(gun_id, name, bore_y, muzzle_z, surfaces=None):
	"""Empty scene and the materials. bore_y, muzzle_z: where the bore ends in model
	space (the muzzle centre becomes the asset-space origin). surfaces: extra or
	changed entries of SURF, e.g. {'drum': dict(SURF['polymer'], base=(0.21, 0.21, 0.205))}."""
	global scene, coll
	bpy.ops.wm.read_factory_settings(use_empty=True)
	scene = bpy.context.scene
	coll = scene.collection
	SURF.update(surfaces or {})
	MATS.clear()
	MATS.update({k: bpy.data.materials.new(k) for k in SURF})
	PARTS.clear()
	PIECES.clear()
	TEXEL.clear()
	POINTS.clear()
	CURRENT[0] = 0
	GUN.update(id=gun_id, name=name, bore_y=bore_y, muzzle_z=muzzle_z, tmp=tempfile.mkdtemp(prefix=gun_id + '-'))

def G(x, y, z):
	"""Model space (three.js axes) to Blender: (x, y, z) -> (x, -z, y)."""
	return Vector((x, -z, y))

@contextmanager
def moving(name, pivot):
	"""A part of the gun that moves on its own: every part() and fix() inside the
	`with` belongs to it. In the file it is a node called `name` whose origin is
	`pivot` (model space: the hinge, the trigger pin, the seat of the magazine, the
	bolt axis), with its mesh as a child. It shares the material and the textures."""
	names = [p[0] for p in PIECES]
	if name not in names:
		PIECES.append((name, tuple(pivot)))
		names.append(name)
	before = CURRENT[0]
	CURRENT[0] = names.index(name) + 1
	try:
		yield
	finally:
		CURRENT[0] = before

def point(name, at, turn=(0, 0, 0), under=None):
	"""A named point (an empty node in the file): `at` in model space, `turn` its
	XYZ Euler angles there, `under` the moving piece it travels with (None: the body)."""
	POINTS.append((name, tuple(at), tuple(turn), under))

def add(o):
	"""Add an object to the gun, as a piece of the moving part it was made in."""
	a = o.data.attributes.get('piece') or o.data.attributes.new('piece', 'INT', 'FACE')
	a.data.foreach_set('value', [CURRENT[0]] * len(o.data.polygons))
	PARTS.append(o)
	return o

# ---------------------------------------------------------------------
# Mesh helpers (bmesh), all coordinates in model space.

def obj(name, bm, mat):
	me = bpy.data.meshes.new(name)
	bm.to_mesh(me)
	bm.free()
	o = bpy.data.objects.new(name, me)
	coll.objects.link(o)
	if mat:
		me.materials.append(MATS[mat])
	return o

def box(name, mat, c, s, rot=None):
	"""Box: centre c, size s (model space); rot: (axis, rad) turn about its centre."""
	bm = bmesh.new()
	bmesh.ops.create_cube(bm, size=1)
	bmesh.ops.scale(bm, vec=Vector((s[0], s[2], s[1])), verts=bm.verts)
	if rot:
		ax = {'x': Vector((1, 0, 0)), 'y': Vector((0, 0, 1)), 'z': Vector((0, -1, 0))}[rot[0]]
		bmesh.ops.rotate(bm, cent=Vector(), matrix=Matrix.Rotation(rot[1], 3, ax), verts=bm.verts)
	bmesh.ops.translate(bm, vec=G(*c), verts=bm.verts)
	return obj(name, bm, mat)

def rod(name, mat, p0, p1, r0, r1=None, seg=24, phase=0.0):
	"""Cylinder or cone from p0 (radius r0) to p1 (radius r1), model space."""
	a, b = G(*p0), G(*p1)
	d = b - a
	bm = bmesh.new()
	bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r0, radius2=r0 if r1 is None else r1, depth=d.length)
	if phase:
		bmesh.ops.rotate(bm, cent=Vector(), matrix=Matrix.Rotation(phase, 3, 'Z'), verts=bm.verts)
	q = Vector((0, 0, 1)).rotation_difference(d.normalized())
	bmesh.ops.rotate(bm, cent=Vector(), matrix=q.to_matrix(), verts=bm.verts)
	bmesh.ops.translate(bm, vec=(a + b) / 2, verts=bm.verts)
	return obj(name, bm, mat)

def extrude(name, mat, pts, step):
	"""A flat polygon (Blender points) pushed along a vector: a prism."""
	bm = bmesh.new()
	f = bm.faces.new([bm.verts.new(p) for p in pts])
	geom = bmesh.ops.extrude_face_region(bm, geom=[f])['geom']
	bmesh.ops.translate(bm, vec=step, verts=[v for v in geom if isinstance(v, bmesh.types.BMVert)])
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	return obj(name, bm, mat)

def side(name, mat, prof, x0, x1):
	"""Side profile [(z, y), ...] extruded across x from x0 to x1."""
	return extrude(name, mat, [G(x0, y, z) for z, y in prof], Vector((x1 - x0, 0, 0)))

def section(name, mat, prof, z0, z1):
	"""Cross-section [(x, y), ...] extruded along the bore from z0 to z1."""
	return extrude(name, mat, [G(x, y, z0) for x, y in prof], G(0, 0, z1 - z0))

def ring(name, mat, c, axis, r_out, r_in, length, seg=32):
	"""Tube (washer) on an axis through c; the hole is a boolean cut."""
	d = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[axis]
	h = length / 2
	p0 = tuple(c[i] - d[i] * h for i in range(3))
	p1 = tuple(c[i] + d[i] * h for i in range(3))
	o = rod(name, mat, p0, p1, r_out, seg=seg)
	q0 = tuple(c[i] - d[i] * (h + 0.2) for i in range(3))
	q1 = tuple(c[i] + d[i] * (h + 0.2) for i in range(3))
	cut(o, [rod(name + '-hole', None, q0, q1, r_in, seg=seg)])
	return o

def torus(name, mat, c, axis, R, r, seg=20, sides=8):
	"""Ring of round section (a sling loop): centre c, its plane normal to the axis."""
	bm = bmesh.new()
	rows = []
	for i in range(seg):
		a = 2 * math.pi * i / seg
		rows.append([])
		for j in range(sides):
			b = 2 * math.pi * j / sides
			p = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
			rows[-1].append(bm.verts.new(p))
	for i in range(seg):
		for j in range(sides):
			a, b = rows[i][j], rows[i][(j + 1) % sides]
			c2, d = rows[(i + 1) % seg][(j + 1) % sides], rows[(i + 1) % seg][j]
			bm.faces.new([a, b, c2, d])
	n = {'x': Vector((1, 0, 0)), 'y': Vector((0, 0, 1)), 'z': Vector((0, -1, 0))}[axis]
	q = Vector((0, 0, 1)).rotation_difference(n)
	bmesh.ops.rotate(bm, cent=Vector(), matrix=q.to_matrix(), verts=bm.verts)
	bmesh.ops.translate(bm, vec=G(*c), verts=bm.verts)
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	return obj(name, bm, mat)

def apply(o):
	"""Apply the modifier stack: the evaluated mesh becomes the object's mesh."""
	dg = bpy.context.evaluated_depsgraph_get()
	me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
	old = o.data
	o.modifiers.clear()
	o.data = me
	bpy.data.meshes.remove(old)

def join(objs):
	"""Join objects into the first one."""
	if len(objs) == 1:
		return objs[0]
	# Blender 5.2 can leave the view layer stale after cutters are removed: resync it first.
	bpy.context.view_layer.update()
	# Skip entries of objects a cut just removed (the view layer list can lag behind).
	for o in bpy.context.view_layer.objects:
		if o is not None:
			o.select_set(False)
	for o in objs:
		o.select_set(True)
	bpy.context.view_layer.objects.active = objs[0]
	with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
		bpy.ops.object.join()
	return objs[0]

def cut(o, cutters, dark=False, mat=None):
	"""Boolean difference (exact solver); dark: the cut faces take the dark material (bores, ports, slots);
	mat: that surface instead ('inner' for a well or a raceway)."""
	c = join(cutters)
	mat = mat or ('dark' if dark else None)
	if mat:
		c.data.materials.clear()
		c.data.materials.append(MATS[mat])
	m = o.modifiers.new('cut', 'BOOLEAN')
	m.object = c
	m.operation = 'DIFFERENCE'
	m.solver = 'EXACT'
	m.material_mode = 'TRANSFER' if mat else 'INDEX'
	apply(o)
	bpy.data.objects.remove(c)
	return o

def bevel(o, w, seg=2, angle=30):
	"""Small bevel on the hard edges; hardened normals keep the flat faces flat."""
	o.data.shade_smooth()
	m = o.modifiers.new('bevel', 'BEVEL')
	m.width = w
	m.segments = seg
	m.limit_method = 'ANGLE'
	m.angle_limit = math.radians(angle)
	m.use_clamp_overlap = True
	m.harden_normals = True
	m.miter_outer = 'MITER_ARC'
	apply(o)
	return o

def part(o, w=None, seg=2, angle=30):
	if w:
		bevel(o, w, seg, angle)
	else:
		o.data.shade_smooth()
		o.data.set_sharp_from_angle(angle=math.radians(angle))
	return add(o)

def tris(o):
	return sum(len(p.vertices) - 2 for p in o.data.polygons)

def lathe(name, mat, prof, c, axis, seg=32, closed=False):
	"""Profile [(r, t), ...] turned about an axis ('x' or 'z') through c: r from the axis, t along it."""
	d = {'x': (1, 0, 0), 'z': (0, 0, 1)}[axis]
	bm = bmesh.new()
	vs = [bm.verts.new(G(c[0] + d[0] * t, c[1] + r, c[2] + d[2] * t)) for r, t in prof]
	es = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
	if closed:
		es.append(bm.edges.new((vs[-1], vs[0])))
	bmesh.ops.spin(bm, geom=vs + es, cent=G(*c), axis=G(*d), angle=2 * math.pi, steps=seg, use_merge=True)
	bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
	bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	return obj(name, bm, mat)

def fix(o, angle=50):
	"""Normals after cuts into a bevelled part: edges over the angle stay sharp, and
	weighted normals (face area) keep the big faces flat while the bevels turn the light."""
	if 'custom_normal' in o.data.attributes:
		o.data.attributes.remove(o.data.attributes['custom_normal'])
	o.data.shade_smooth()
	o.data.set_sharp_from_angle(angle=math.radians(angle))
	m = o.modifiers.new('wn', 'WEIGHTED_NORMAL')
	m.mode = 'FACE_AREA'
	m.keep_sharp = True
	m.weight = 50
	apply(o)
	return add(o)

def screw(name, p0, p1, r, seg=8):
	"""Slotted screw head from p0 (in the part) to p1 (proud): the slot is a cut across the head."""
	o = rod(name, 'bright', p0, p1, r, seg=seg, phase=math.pi / seg)
	d = (Vector(p1) - Vector(p0)).normalized()
	c = Vector(p1)
	size = [r * 2.8 if abs(d[i]) < 0.5 else 0.12 for i in range(3)]
	# The slot runs along the bore (or across it on a face that looks along the bore).
	if abs(d[2]) < 0.5:
		size[1] = r * 0.4
	else:
		size[0] = r * 0.4
	cut(o, [box(name + '-slot', None, tuple(c), tuple(size))], dark=True)
	fix(o, 40)
	return o


def cartridge(name, base, length, r, seg=10, case=0.62):
	"""A round lying along the bore, its rim at `base` (model space), pointing forward: case, shoulder, bullet."""
	c = case * length
	part(lathe(name, 'brass', [(0, 0), (r, 0), (r, -0.06 * length), (r * 0.9, -0.09 * length), (r * 0.95, -c), (r * 0.72, -c - 0.06 * length),
		(r * 0.66, -0.8 * length), (r * 0.3, -0.96 * length), (0, -length)], base, 'z', seg=seg), None, angle=40)

# ---------------------------------------------------------------------
# Bake set-up (Cycles): per surface the base colour, roughness and metalness
# through an emission shader; tangent-space normals from rounded edges.

def lin(c):
	return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)

def socket(node, ident):
	return next(s for s in node.inputs if s.identifier == ident)

def out_socket(node, ident):
	return next(s for s in node.outputs if s.identifier == ident)

# Wear and grime (finish(wear=...)): the strength of each part of the pass, 1 = as tuned on the shotgun;
# radius: width of the worn band along an edge (model units, wider reads from further away); width scales it.
WEAR = dict(edge=1.0, grime=1.0, vary=1.0, radius=0.07, width=1.0)
# Per kind: how far edges wear and cavities take grime, how much the large-scale variation moves
# the colour (fraction) and roughness (absolute).
KIND = {
	'metal': dict(edge=1.0, grime=1.0, tone=0.14, rough=0.1),
	'polymer': dict(edge=0.9, grime=1.0, tone=0.11, rough=0.07),
	'rubber': dict(edge=0.4, grime=1.1, tone=0.08, rough=0.05),
	'cloth': dict(edge=0.5, grime=0.8, tone=0.12, rough=0.05),
	'none': dict(edge=0.0, grime=0.0, tone=0.0, rough=0.0),
}
GRIME = dict(color=(0.07, 0.064, 0.056), rough=0.88)
# Mask debugging: MASK=edge|grime|vary in the options writes that mask as the base colour.
MASK = OPT.get('mask')

def bake_nodes(mat, p):
	"""The bake shader of one surface: colour, roughness and metalness as emission inputs.
	Wear: convex edges (where a rounded normal leaves the true one and the short-range
	occlusion is open) turn lighter and smoother, broken up by noise. Grime: concave
	areas (short-range occlusion) turn darker and rougher. Variation: a large, soft
	noise moves the tone and roughness a few percent so flat panels aren't uniform."""
	mat.use_nodes = True
	nt = mat.node_tree
	N, L = nt.nodes, nt.links
	N.clear()
	k = KIND[p.get('kind', 'none')]
	def math_node(op, a, b=None):
		n = N.new('ShaderNodeMath')
		n.operation = op
		n.use_clamp = op in ('MULTIPLY',)
		for i, v in enumerate((a, b)):
			if v is None:
				continue
			if isinstance(v, (int, float)):
				n.inputs[i].default_value = v
			else:
				L.new(v, n.inputs[i])
		return n.outputs[0]
	def map_range(v, a, b, c=0.0, d=1.0):
		n = N.new('ShaderNodeMapRange')
		n.clamp = True
		L.new(v, n.inputs['Value'])
		n.inputs['From Min'].default_value = a
		n.inputs['From Max'].default_value = b
		n.inputs['To Min'].default_value = c
		n.inputs['To Max'].default_value = d
		return n.outputs['Result']
	def noise(scale, detail, vec=None):
		n = N.new('ShaderNodeTexNoise')
		n.inputs['Scale'].default_value = scale
		n.inputs['Detail'].default_value = detail
		L.new(vec or tc.outputs['Object'], n.inputs['Vector'])
		return n.outputs['Fac']
	def ao(distance, samples=16):
		n = N.new('ShaderNodeAmbientOcclusion')
		n.samples = samples
		n.inputs['Distance'].default_value = distance
		return n.outputs['AO']
	def rgb(c):
		n = N.new('ShaderNodeRGB')
		n.outputs[0].default_value = (*lin(c), 1)
		return n.outputs[0]
	def mixc(a, b, f):
		n = N.new('ShaderNodeMix')
		n.data_type = 'RGBA'
		L.new(f, socket(n, 'Factor_Float'))
		L.new(a, socket(n, 'A_Color'))
		L.new(b, socket(n, 'B_Color'))
		return out_socket(n, 'Result_Color')
	def mixf(a, b, f):
		n = N.new('ShaderNodeMix')
		n.data_type = 'FLOAT'
		L.new(f, socket(n, 'Factor_Float'))
		for s, v in (('A_Float', a), ('B_Float', b)):
			if isinstance(v, (int, float)):
				socket(n, s).default_value = v
			else:
				L.new(v, socket(n, s))
		return out_socket(n, 'Result_Float')
	out = N.new('ShaderNodeOutputMaterial')
	out.name = 'out'
	geo = N.new('ShaderNodeNewGeometry')
	tc = N.new('ShaderNodeTexCoord')
	# Edge mask: where a rounded normal leaves the true one (convex and concave edges alike).
	bev = N.new('ShaderNodeBevel')
	bev.samples = 12
	bev.inputs['Radius'].default_value = WEAR['radius'] * WEAR['width']
	dot = N.new('ShaderNodeVectorMath')
	dot.operation = 'DOT_PRODUCT'
	L.new(bev.outputs['Normal'], dot.inputs[0])
	L.new(geo.outputs['Normal'], dot.inputs[1])
	edge = map_range(dot.outputs['Value'], 0.995, 0.9)
	# Short-range occlusion: open on a convex edge, closed in an inside corner or a gap.
	near = ao(0.3)
	convex = math_node('MULTIPLY', edge, map_range(near, 0.72, 0.92))
	brk = map_range(noise(2.2, 8), 0.32, 0.6)
	wear = math_node('MULTIPLY', math_node('MULTIPLY', convex, brk), p['amount'] * k['edge'] * WEAR['edge'])
	# Cavity grime: occlusion within about half a unit, patchy (low-frequency noise).
	cav = map_range(ao(0.6), 0.95, 0.45)
	patch = map_range(noise(0.35, 3), 0.3, 0.7, 0.55, 1.0)
	grime = math_node('MULTIPLY', math_node('MULTIPLY', cav, patch), 0.9 * k['grime'] * WEAR['grime'])
	# Large-scale variation, about -1..1: soft blotches a few units across and a finer, fainter mottle.
	big = map_range(noise(0.12, 2), 0.3, 0.7, -1.0, 1.0)
	small = map_range(noise(1.1, 3), 0.3, 0.7, -0.35, 0.35)
	vary = math_node('MULTIPLY', math_node('ADD', big, small), WEAR['vary'])
	tone = math_node('ADD', 1.0, math_node('MULTIPLY', vary, k['tone']))
	base = N.new('ShaderNodeMix')
	base.data_type = 'RGBA'
	base.blend_type = 'MULTIPLY'
	socket(base, 'Factor_Float').default_value = 1.0
	L.new(rgb(p['base']), socket(base, 'A_Color'))
	L.new(tone, socket(base, 'B_Color'))
	col = mixc(out_socket(base, 'Result_Color'), rgb(p['wear']), wear)
	col = mixc(col, rgb(GRIME['color']), grime)
	rough = math_node('ADD', mixf(p['rough'], p['wrough'], wear), math_node('MULTIPLY', vary, k['rough']))
	rough = mixf(rough, GRIME['rough'], grime)
	metal = mixf(mixf(p['metal'], p['wmetal'], wear), 0.0, math_node('MULTIPLY', grime, 0.5))
	if MASK:
		m = {'edge': wear, 'grime': grime, 'vary': map_range(vary, -1, 1)}[MASK]
		c = N.new('ShaderNodeCombineColor')
		for s in ('Red', 'Green', 'Blue'):
			L.new(m, c.inputs[s])
		col = c.outputs[0]
	emit = N.new('ShaderNodeEmission')
	emit.name = 'emit'
	# Normals: rounded edges.
	nb = N.new('ShaderNodeBevel')
	nb.samples = 12
	nb.inputs['Radius'].default_value = 0.035
	dif = N.new('ShaderNodeBsdfDiffuse')
	dif.name = 'diffuse'
	L.new(nb.outputs['Normal'], dif.inputs['Normal'])
	plain = N.new('ShaderNodeBsdfDiffuse')
	plain.name = 'plain'
	img = N.new('ShaderNodeTexImage')
	img.name = 'target'
	N.active = img
	return {'color': col, 'rough': rough, 'metal': metal}

def _bake(me, chan, kind, size, samples):
	img = bpy.data.images.new('bake-' + kind, size, size, alpha=False, float_buffer=True)
	img.colorspace_settings.name = 'Non-Color'
	for m in me.materials:
		N, L = m.node_tree.nodes, m.node_tree.links
		out = N['out']
		for l in list(out.inputs['Surface'].links):
			L.remove(l)
		if kind in chan[m.name]:
			L.new(chan[m.name][kind], N['emit'].inputs['Color'])
			L.new(N['emit'].outputs[0], out.inputs['Surface'])
		else:
			L.new(N['diffuse' if kind == 'normal' else 'plain'].outputs[0], out.inputs['Surface'])
		N['target'].image = img
		N.active = N['target']
	scene.cycles.samples = samples
	t = time.time()
	bpy.ops.object.bake(type={'color': 'EMIT', 'rough': 'EMIT', 'metal': 'EMIT', 'normal': 'NORMAL', 'ao': 'AO'}[kind], margin=16, use_clear=True, normal_space='TANGENT')
	print('BAKE', kind, size, round(time.time() - t, 1), 's')
	a = np.empty(size * size * 4, dtype=np.float32)
	img.pixels.foreach_get(a)
	return a.reshape(size, size, 4)

def _down(a, k):
	h, w = a.shape[:2]
	return a.reshape(h // k, k, w // k, k, -1).mean(axis=(1, 3))

def _srgb(a):
	a = np.clip(a, 0, 1)
	return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)

def _save(name, rgb):
	h, w = rgb.shape[:2]
	img = bpy.data.images.new(name, w, h, alpha=False)
	img.colorspace_settings.name = 'Non-Color'
	px = np.ones((h, w, 4), dtype=np.float32)
	px[..., :3] = np.clip(rgb, 0, 1)
	img.pixels.foreach_set(px.ravel())
	path = os.path.join(GUN['tmp'], name + '.png')
	img.filepath_raw = path
	img.file_format = 'PNG'
	img.save()
	return path

# ---------------------------------------------------------------------
# The end of every gun script.

def finish(fit, budget='plain', wear=1.0, bake=None):
	"""Join the parts into one mesh, unwrap, cut slivers, check the triangle
	budget, bake, split the moving pieces off again, export the GLB in asset
	space, print the fit data, render. The bake sees the whole gun at rest, so a
	gun with moving pieces looks like one without.
	fit: model-space points {'grip', 'fore', 'sight', 'front'} (None where the gun
	has none), printed in asset space for render/weapon-assets.ts.
	budget: 'plain' or 'detailed' (MODEL_BUDGET). wear: strength of the wear and grime pass,
	one number for all of it or a dict with edge, grime and vary (1 = as on the shotgun, 0 = clean),
	and optionally radius (width of the worn edge band, 0.07 by default) and width (a factor on it).
	bake: bake size (default twice the texture size)."""
	gun, tri_piece, LENGTH, TRI = textured(budget, wear, bake)
	me = gun.data

	# Asset space: muzzle centre at the origin, length 1 along the bore.
	muzzle = G(0, GUN['bore_y'], GUN['muzzle_z'])
	to_asset_space = Matrix.Scale(1 / LENGTH, 4) @ Matrix.Translation(-muzzle)
	front = max(v.co.y for v in me.vertices) - (-GUN['muzzle_z'])
	shipped = split(gun, tri_piece, to_asset_space)
	me.transform(to_asset_space)
	me.update()
	print('LENGTH', round(LENGTH, 4), 'front', round(front, 4))
	if abs(front) > 1e-3:
		print('WARNING: the muzzle is not the front of the model (%.4f past it): asset space needs it there' % front)
	print_fit(fit, LENGTH)
	print('NODES', ' '.join([p[0] for p in PIECES] + [p[0] for p in POINTS]))
	if OUT:
		export(shipped, TRI)
	if RENDERS:
		render(gun, RENDERS)
	print('DONE', round(time.time() - T0, 1), 's')
	return gun

def export(objects, triangles, **options):
	"""Write these objects to the GLB of the command line."""
	bpy.context.view_layer.update()
	for o in bpy.context.view_layer.objects:
		o.select_set(False)
	for o in objects:
		o.select_set(True)
	bpy.context.view_layer.objects.active = objects[0]
	bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, use_selection=True,
		export_image_format='AUTO', export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT', **options)
	print('EXPORT', OUT, os.path.getsize(OUT), 'bytes', triangles, 'tris', 'total', round(time.time() - T0, 1), 's')

def textured(budget, wear, bake=None):
	"""The first half of finish(): one mesh of all parts, unwrapped, within its triangle
	budget, baked, with the shipped material. Returns it, the piece of each triangle,
	the length along the bore and the number of triangles."""
	WEAR.update(wear if isinstance(wear, dict) else dict(edge=wear, grime=wear, vary=wear))
	budget = OPT.get('budget', budget)  # budget=detailed on the command line: try the other tier
	B = BUDGETS[budget]
	TEX = B['tex']
	BAKE = int(OPT.get('bake', bake or 2 * TEX))
	TEX = min(TEX, BAKE)
	print('BUDGET', budget, B['triangles'], 'tris', B['bytes'], 'bytes', TEX, 'px')

	# One mesh, one UV unwrap. A part whose cut left an empty material slot: the part's own material there.
	for p in PARTS:
		own = next((m for m in p.data.materials if m), None)
		for i, m in enumerate(p.data.materials):
			if m is None:
				p.data.materials[i] = own
	STATS = [(p.name, tris(p)) for p in PARTS]
	# Each part is unwrapped on its own: over the whole gun the projection directions are shared, and
	# a part that suits none of them folds over itself in its island (blotches in the bake).
	bpy.context.view_layer.update()
	def edit_only(o):
		for q in bpy.context.view_layer.objects:
			if q is not None:
				q.select_set(False)
		o.select_set(True)
		bpy.context.view_layer.objects.active = o
		bpy.ops.object.mode_set(mode='EDIT')
		bpy.ops.mesh.select_all(action='SELECT')
	for p in PARTS:
		edit_only(p)
		bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
		bpy.ops.object.mode_set(mode='OBJECT')
	gun = join(PARTS)
	gun.name = 'joined'
	me = gun.data
	edit_only(gun)
	bpy.ops.uv.select_all(action='SELECT')
	bpy.ops.uv.average_islands_scale()
	if TEXEL:
		# Less texture for a piece that is far from the eye: its islands shrink before they are packed.
		bm = bmesh.from_edit_mesh(me)
		uvl, layer = bm.loops.layers.uv.active, bm.faces.layers.int['piece']
		factor = {i + 1: TEXEL[p[0]] for i, p in enumerate(PIECES) if p[0] in TEXEL}
		for f in bm.faces:
			if f[layer] in factor:
				for l in f.loops:
					l[uvl].uv *= factor[f[layer]]
		bmesh.update_edit_mesh(me)
	bpy.ops.uv.pack_islands(rotate=True, margin=0.003, shape_method=OPT.get('shape', 'CONCAVE'))
	bpy.ops.object.mode_set(mode='OBJECT')
	# Length along the bore: the asset-space unit.
	ys = [v.co.y for v in me.vertices]
	LENGTH = max(ys) - min(ys)
	# Triangles, and none thinner than LENGTH / 20800 (0.002 on a gun 41.67 long):
	# boolean and bevel seams leave a few slivers that the quantisation of the
	# shipped file (about LENGTH / 32000) turns into lines, and a test that samples
	# the screen reads such a triangle as covering every point on its line.
	# The custom normals ride along on the corners.
	thin = LENGTH / 20800
	bm = bmesh.new()
	bm.from_mesh(me)
	bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
	flat = [f for f in bm.faces if 2 * f.calc_area() / max(e.calc_length() for e in f.edges) < thin]
	bmesh.ops.delete(bm, geom=flat, context='FACES_ONLY')
	bm.to_mesh(me)
	bm.free()
	print('SLIVERS', len(flat))
	TRI = tris(gun)
	print('TRIS', TRI, 'of', B['triangles'], 'geometry', round(time.time() - T0, 1), 's')
	tri_piece = np.empty(len(me.polygons), dtype=np.int32)
	me.attributes['piece'].data.foreach_get('value', tri_piece)
	print('PIECES', ' '.join('%s %d' % (n, int((tri_piece == i).sum())) for i, n in enumerate([GUN['name'].replace(' ', '-')] + [p[0] for p in PIECES])))
	if OPT.get('overlap'):  # overlap=1: texels that two triangles share, and where they are
		uv = np.empty(len(me.loops) * 2, dtype=np.float32)
		me.uv_layers.active.data.foreach_get('uv', uv)
		uv = uv.reshape(-1, 3, 2) * 1024
		owner = np.full((1024, 1024), -1, dtype=np.int32)
		shared = {}
		for t, (a, b, c) in enumerate(uv):
			x0, y0 = np.maximum(np.floor(np.minimum(np.minimum(a, b), c)).astype(int), 0)
			x1, y1 = np.minimum(np.ceil(np.maximum(np.maximum(a, b), c)).astype(int), 1023)
			d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
			if abs(d) < 1e-9 or x1 < x0 or y1 < y0:
				continue
			X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
			w1 = ((X - a[0]) * (c[1] - a[1]) - (Y - a[1]) * (c[0] - a[0])) / d
			w2 = ((b[0] - a[0]) * (Y - a[1]) - (b[1] - a[1]) * (X - a[0])) / d
			inside = (w1 > 0.02) & (w2 > 0.02) & (w1 + w2 < 0.98)
			block = owner[y0:y1 + 1, x0:x1 + 1]
			for o in block[inside & (block >= 0)]:
				shared[(int(o), t)] = shared.get((int(o), t), 0) + 1
			block[inside] = t
		print('OVERLAP', sum(shared.values()), 'texels', [(n, tuple(round(v, 1) for v in me.polygons[i].center), tuple(round(v, 1) for v in me.polygons[j].center)) for (i, j), n in sorted(shared.items(), key=lambda s: -s[1])[:8]])
	if OPT.get('parts'):  # parts=1: the heaviest parts, before triangulation
		for p in sorted(STATS, key=lambda s: -s[1])[:60]:
			print('PART', *p)
	if TRI > B['triangles']:
		raise SystemExit('over the %s triangle budget: %d > %d' % (budget, TRI, B['triangles']))

	scene.render.engine = 'CYCLES'
	scene.cycles.device = 'CPU'
	scene.render.bake.margin = 16
	world = bpy.data.worlds.new('bake')
	scene.world = world
	world.light_settings.distance = 1.6
	chan = {m.name: bake_nodes(m, SURF[m.name]) for m in me.materials}
	# Enough samples that the bevel and occlusion shaders leave no grain: a smooth map is a small file.
	col = _bake(me, chan, 'color', BAKE, 64)
	ao = _bake(me, chan, 'ao', BAKE, 48)
	nrm = _bake(me, chan, 'normal', BAKE, 64)
	rough = _bake(me, chan, 'rough', BAKE // 2, 48)
	metal = _bake(me, chan, 'metal', BAKE // 2, 8)

	# What a moving piece hides at rest (a magazine in its well, the well itself) bakes black and grimy. Those texels
	# take a second, smaller bake with the pieces moved apart; the ones that show at rest keep the bake of the whole gun.
	if PIECES and not MASK:
		co = np.empty(len(me.vertices) * 3, dtype=np.float32)
		me.vertices.foreach_get('co', co)
		corners = np.empty(len(me.loops), dtype=np.int32)
		me.loops.foreach_get('vertex_index', corners)
		apart = co.reshape(-1, 3).copy()
		where = np.zeros(len(me.vertices), dtype=np.int32)
		where[corners] = np.repeat(tri_piece, 3)
		apart[:, 0] += where * 6 * LENGTH
		me.vertices.foreach_set('co', apart.ravel())
		me.update()
		k = BAKE // TEX
		col2 = np.repeat(np.repeat(_bake(me, chan, 'color', TEX, 48), k, axis=0), k, axis=1)
		ao2 = np.repeat(np.repeat(_bake(me, chan, 'ao', TEX, 48), k, axis=0), k, axis=1)
		me.vertices.foreach_set('co', co)
		me.update()
		hidden = 1 - np.clip((ao[..., :1] - 0.03) / 0.17, 0, 1)
		col = col + (col2 - col) * hidden
		ao = ao + (ao2 - ao) * hidden

	# Base colour: the ambient occlusion multiplied in, so the shape reads under the flat viewmodel light.
	occl = 1 - (0 if MASK else 0.75) * (1 - ao[..., :1])
	base_path = _save('base', _srgb(_down(col[..., :3] * occl, BAKE // TEX)))
	n = _down(nrm[..., :3] * 2 - 1, BAKE // TEX)
	n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-8
	normal_path = _save('normal', n * 0.5 + 0.5)
	ORM = TEX // 2
	k = (BAKE // 2) // ORM
	orm = np.ones((ORM, ORM, 3), dtype=np.float32)
	orm[..., 1] = np.clip(_down(rough[..., :1], k)[..., 0], 0.05, 1)
	orm[..., 2] = np.clip(_down(metal[..., :1], k)[..., 0], 0, 1)
	orm_path = _save('orm', orm)

	# The shipped material: one, with the three maps.
	mat = bpy.data.materials.new(GUN['name'])
	mat.use_nodes = True
	mat.use_backface_culling = True
	N, L = mat.node_tree.nodes, mat.node_tree.links
	bsdf = N['Principled BSDF']
	def load(path, cs):
		img = bpy.data.images.load(path)
		img.colorspace_settings.name = cs
		n = N.new('ShaderNodeTexImage')
		n.image = img
		return n
	tb = load(base_path, 'sRGB')
	L.new(tb.outputs['Color'], bsdf.inputs['Base Color'])
	tn = load(normal_path, 'Non-Color')
	nm = N.new('ShaderNodeNormalMap')
	L.new(tn.outputs['Color'], nm.inputs['Color'])
	L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
	to = load(orm_path, 'Non-Color')
	sep = N.new('ShaderNodeSeparateColor')
	L.new(to.outputs['Color'], sep.inputs['Color'])
	L.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
	L.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
	me.name = 'joined'
	me.materials.clear()
	me.materials.append(mat)
	me.polygons.foreach_set('material_index', [0] * len(me.polygons))
	return gun, tri_piece, LENGTH, TRI

def split(gun, tri_piece, to_asset_space):
	"""The exported objects: the body as one mesh, each moving piece as an empty at its
	pivot with its mesh as a child (the compression moves the origin of a mesh node, not
	of its parent), each point as an empty. All in asset space, all with the gun's material."""
	for o in list(bpy.data.objects):
		if o != gun:
			bpy.data.objects.remove(o)
	def node(name, parent=None):
		o = bpy.data.objects.new(name, None)
		coll.objects.link(o)
		o.parent = parent
		return o
	out, empties = [], {None: None}
	for i, (name, pivot) in enumerate([(GUN['name'], None)] + PIECES):
		me = gun.data.copy()
		bm = bmesh.new()
		bm.from_mesh(me)
		layer = bm.faces.layers.int['piece']
		bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[layer] != i], context='FACES')
		bm.to_mesh(me)
		bm.free()
		me.attributes.remove(me.attributes['piece'])
		me.transform(to_asset_space)
		origin = Vector()
		if pivot is not None:
			origin = to_asset_space @ G(*pivot)
			me.transform(Matrix.Translation(-origin))
			empties[name] = node(name)
			empties[name].location = origin
			out.append(empties[name])
		me.update()
		me.name = name + ('' if pivot is None else '-mesh')
		o = bpy.data.objects.new(me.name, me)
		coll.objects.link(o)
		o.parent = empties.get(name)
		out.append(o)
		GUN.setdefault('origin', {})[name] = origin
	# Three.js axes to Blender's and back, for the turns.
	C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
	for name, at, turn, under in POINTS:
		o = node(name, empties[under])
		o.location = to_asset_space @ G(*at) - (GUN['origin'][under] if under else Vector())
		r = Matrix.Rotation(turn[0], 3, 'X') @ Matrix.Rotation(turn[1], 3, 'Y') @ Matrix.Rotation(turn[2], 3, 'Z')
		o.rotation_euler = (C @ r @ C.transposed()).to_euler()
		out.append(o)
	return out

def to_asset(p, length):
	"""A model-space point in asset space (muzzle centre at the origin, length 1)."""
	return tuple(round((p[i] - (0, GUN['bore_y'], GUN['muzzle_z'])[i]) / length, 4) for i in range(3))

def print_fit(fit, length):
	"""The fit data for render/weapon-assets.ts (GENERATED.<id>), in asset space."""
	def v(k):
		p = fit.get(k)
		return 'null' if p is None else '[%s]' % ', '.join(('%g' % c) for c in to_asset(p, length))
	print('FIT %s: { grip: %s, fore: %s, sight: %s, front: %s, fp: { len: %g, at: [0, %g, %g] } }' % (
		GUN['id'], v('grip'), v('fore'), v('sight'), v('front'), round(length, 2), GUN['bore_y'], GUN['muzzle_z']))

# ---------------------------------------------------------------------
# Neutral renders (Cycles on the CPU, so they also run on a server without a
# GPU, where Eevee crashes): side and three-quarter views on grey, framed on the
# model (asset space: length 1 along the bore).

def render(gun, folder):
	os.makedirs(folder, exist_ok=True)
	scene.render.engine = 'CYCLES'
	scene.cycles.device = 'CPU'
	scene.cycles.samples = 48
	scene.cycles.use_denoising = True
	scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
	scene.render.film_transparent = False
	world = scene.world
	world.use_nodes = True
	world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.32, 0.33, 0.34, 1)
	world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
	scene.view_settings.view_transform = 'AgX'
	sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
	sun.data.energy = 3.0
	sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(140))
	coll.objects.link(sun)
	fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
	fill.data.energy = 1.0
	fill.rotation_euler = (math.radians(60), 0, math.radians(-60))
	coll.objects.link(fill)
	cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
	coll.objects.link(cam)
	scene.camera = cam
	vs = [v.co for v in gun.data.vertices]
	lo = Vector([min(v[i] for v in vs) for i in range(3)])
	hi = Vector([max(v[i] for v in vs) for i in range(3)])
	centre = (lo + hi) / 2
	size = max(hi.y - lo.y, (hi.z - lo.z) * 16 / 9)
	def shoot(name, offset, ortho=None, lens=60):
		cam.location = centre + Vector(offset)
		cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
		if ortho:
			cam.data.type = 'ORTHO'
			cam.data.ortho_scale = ortho
		else:
			cam.data.type = 'PERSP'
			cam.data.lens = lens
		cam.data.clip_start = 0.01
		scene.render.filepath = os.path.join(folder, name)
		bpy.ops.render.render(write_still=True)
		print('RENDER', scene.render.filepath)
	shoot('blender-side-right.png', (3, 0, 0), ortho=size * 1.12)
	shoot('blender-side-left.png', (-3, 0, 0), ortho=size * 1.12)
	shoot('blender-three-quarter.png', (1.1, 1.05, 0.55), lens=50)
	shoot('blender-rear-quarter.png', (0.85, -1.2, 0.5), lens=50)
