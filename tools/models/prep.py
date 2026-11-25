"""
Blender (headless) step of the weapon model build (tools/models/build.sh).
Written for Blender 5.3 (bpy, bmesh and the numpy it bundles).

  Blender -b --factory-startup -P prep.py -- <raw.glb> <id> <manifest.json> <out.glb>

Turns a raw image-to-3D model into the canonical frame of the game, three.js
axes: bore along -Z, +Y up, +X to the right, the middle of the muzzle (the tip
of a blade) at the origin, length along the bore 1. Removes the parts listed in
the manifest (cut boxes, canonical frame), blurs the markings out of the base
colour (paint rectangles, pixels of the source texture, top left origin) and
writes the first-person file (base colour, normal and ORM maps, sizes from the
manifest).
"""
import bpy, bmesh, sys, json, math
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
src, wid, manifest_path, out_fp = argv[:4]
with open(manifest_path) as f:
	manifest = json.load(f)
spec = manifest['models'][wid]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
mesh = obj.data
# Bake the node transform, then the turn that points the bore along Blender +Y (three -Z).
mesh.transform(obj.matrix_world)
obj.matrix_world = Matrix.Identity(4)
mesh.transform(Matrix.Rotation(math.radians(spec['turn']), 4, 'Z'))
for axis, deg in spec.get('tilt', {}).items():
	mesh.transform(Matrix.Rotation(math.radians(deg), 4, axis))

def verts():
	return [v.co.copy() for v in mesh.vertices]

def bore():
	"""Middle of the muzzle and the bore direction: the front 2 % of the length, and a slice further back near the axis."""
	vs = verts()
	ymin = min(v.y for v in vs)
	ymax = max(v.y for v in vs)
	L = ymax - ymin
	front = [v for v in vs if v.y > ymax - spec.get('mouth', 0.02) * L]
	a = sum(front, Vector()) / len(front)
	s0, s1 = spec.get('slice', [0.06, 0.1])
	r = spec.get('radius', 0.02) * L
	back = [v for v in vs if ymax - s1 * L < v.y < ymax - s0 * L and math.hypot(v.x - a.x, v.z - a.z) < r]
	b = sum(back, Vector()) / len(back) if back else Vector((a.x, a.y - 1, a.z))
	return a, b, L, ymax

if spec.get('align', True):
	for _ in range(2):
		a, b, L, ymax = bore()
		d = (a - b).normalized()
		yaw = math.atan2(d.x, d.y)
		mesh.transform(Matrix.Rotation(yaw, 4, 'Z'))
		a, b, L, ymax = bore()
		d = (a - b).normalized()
		pitch = math.atan2(d.z, d.y)
		mesh.transform(Matrix.Rotation(-pitch, 4, 'X'))
		print('ALIGN', wid, 'yaw', round(math.degrees(yaw), 3), 'pitch', round(math.degrees(pitch), 3))

# A gun whose muzzle end misleads the bore estimate (a muzzle brake): turned
# about the vertical by `yaw` degrees more, so receiver and stock line up behind the muzzle.
if spec.get('yaw'):
	mesh.transform(Matrix.Rotation(math.radians(spec['yaw']), 4, 'Z'))
# Origin at the middle of the muzzle, length 1.
a, b, L, ymax = bore()
mesh.transform(Matrix.Scale(1 / L, 4) @ Matrix.Translation(Vector((-a.x, -ymax, -a.z))))
# A muzzle that is not the middle of the front end: move the origin onto the bore.
sx, sy = spec.get('shift', [0, 0])
mesh.transform(Matrix.Translation(Vector((-sx, 0, -sy))))

def to_blender(p):
	"""Canonical (three) point to Blender: (x, y, z) -> (x, -z, y)."""
	return Vector((p[0], -p[2], p[1]))

def inside_any(co, boxes):
	"""Whether a Blender point lies in one of the boxes (canonical frame)."""
	for c in boxes:
		lo = to_blender(c['min'])
		hi = to_blender(c['max'])
		lo, hi = Vector(map(min, lo, hi)), Vector(map(max, lo, hi))
		if all(lo[i] <= co[i] <= hi[i] for i in range(3)):
			return True
	return False

# Cut boxes (canonical frame): faces with a vertex inside go, the holes they leave are closed.
# Tube (an optic, canonical frame): faces with a vertex closer than `r` to the axis (x, y) between
# z0 and z1 go: the glass and anything else inside the tube, so the eye can look through it when
# aiming. The vertices left on the cut edge move onto the circle of radius r: a clean round opening.
cuts = spec.get('cut', [])
tube = spec.get('tube')

def in_tube(co):
	"""Distance from the tube axis of a Blender point inside the tube's length; None outside it."""
	(ax, ay), (z0, z1) = tube['axis'], tube['z']
	if not z0 <= -co.y <= z1:
		return None
	return math.hypot(co.x - ax, co.z - ay)

def tube_face(f):
	return any((d := in_tube(v.co)) is not None and d < tube['r'] for v in f.verts)

if cuts or tube:
	# The importer's normals are kept: every face corner remembers its normal, the cut only removes faces.
	normals = [tuple(n.vector) for n in mesh.corner_normals]
	bm = bmesh.new()
	bm.from_mesh(mesh)
	src = bm.loops.layers.int.new('src')
	fid = bm.faces.layers.int.new('fid')
	bm.faces.ensure_lookup_table()
	for f in bm.faces:
		f[fid] = f.index
		for l, li in zip(f.loops, mesh.polygons[f.index].loop_indices):
			l[src] = li
	# Islands on a welded copy: the importer splits vertices at UV seams.
	w = bm.copy()
	bmesh.ops.remove_doubles(w, verts=w.verts[:], dist=1e-6)
	wfid = w.faces.layers.int.get('fid')
	gone = set(f[wfid] for f in w.faces if (cuts and any(inside_any(v.co, cuts) for v in f.verts)) or (tube and tube_face(f)))
	bmesh.ops.delete(w, geom=[f for f in w.faces if f[wfid] in gone], context='FACES')
	# Drop loose bits the cut left behind (islands below 1 % of the faces).
	seen = set()
	for f in w.faces:
		if f[wfid] in seen:
			continue
		stack = [f]
		island = []
		seen.add(f[wfid])
		while stack:
			g = stack.pop()
			island.append(g[wfid])
			for e in g.edges:
				for h in e.link_faces:
					if h[wfid] not in seen:
						seen.add(h[wfid])
						stack.append(h)
		if len(island) < len(w.faces) * 0.01:
			gone.update(island)
	w.free()
	print('CUT', wid, len(gone), 'faces')
	# Rim: the vertices of the faces the tube removes, by position (the importer splits vertices at UV seams).
	key = lambda co: (round(co.x, 6), round(co.y, 6), round(co.z, 6))
	rim = {key(v.co) for f in bm.faces if f[fid] in gone and tube and tube_face(f) for v in f.verts}
	bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[fid] in gone], context='FACES')
	if tube:
		ax, ay = tube['axis']
		n = 0
		for v in bm.verts:
			if not v.link_faces or key(v.co) not in rim:
				continue
			d = in_tube(v.co)
			if d is None or d <= 0:
				continue
			k = tube['r'] / d
			v.co.x = ax + (v.co.x - ax) * k
			v.co.z = ay + (v.co.z - ay) * k
			n += 1
		print('TUBE', wid, n, 'rim vertices')
	order = [l[src] for f in bm.faces for l in f.loops]
	bm.to_mesh(mesh)
	bm.free()
	mesh.normals_split_custom_set([normals[i] for i in order])
mesh.update()
# A cut that took off the front end (a nub ahead of the muzzle brake): the muzzle face back at the origin, length 1 again.
if spec.get('refront'):
	vs = verts()
	ymin = min(v.y for v in vs)
	ymax = max(v.y for v in vs)
	mesh.transform(Matrix.Scale(1 / (ymax - ymin), 4) @ Matrix.Translation(Vector((0, -ymax, 0))))
	print('REFRONT', wid, round(ymax, 4), round(ymax - ymin, 4))

# Materials: the painted base colour; image sizes from the manifest.
mat = mesh.materials[0]
nodes = mat.node_tree.nodes
tex = {}
for n in nodes:
	if n.type != 'TEX_IMAGE':
		continue
	for l in n.outputs['Color'].links:
		to = l.to_socket.name
		if to == 'Base Color':
			tex['base'] = n
		elif l.to_node.type == 'NORMAL_MAP':
			tex['normal'] = n
		else:
			tex['orm'] = n
def paint(img, rects):
	"""Blur each rectangle (x, y, w, h; top left origin) hard: no stroke of a marking stays readable."""
	w, h = img.size
	px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
	# Rectangles and blur are given for a 2048 px texture: scaled to the size of this one.
	s = w / 2048
	for x, y, rw, rh in rects:
		x, y, rw, rh = (round(v * s) for v in (x, y, rw, rh))
		y0 = h - (y + rh)
		pad = round(24 * s)
		x0, x1 = max(0, x - pad), min(w, x + rw + pad)
		ya, yb = max(0, y0 - pad), min(h, y0 + rh + pad)
		block = px[ya:yb, x0:x1, :3].copy()
		# Grey: a coloured sticker leaves no tinted patch.
		block[:] = (block @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))[..., None]
		for _ in range(4):
			for axis in (0, 1):
				k = round(15 * s)
				c = np.cumsum(np.pad(block, [(k, k) if i == axis else (0, 0) for i in range(3)], mode='edge'), axis=axis)
				n = block.shape[axis]
				hi = np.take(c, np.arange(2 * k, 2 * k + n), axis=axis)
				lo = np.take(c, np.arange(0, n), axis=axis)
				block = (hi - lo) / (2 * k)
		# Feather the edge of the rectangle into the untouched texture.
		yy, xx = np.mgrid[ya:yb, x0:x1]
		dx = np.minimum(xx - (x - pad), (x + rw + pad) - xx) / pad
		dy = np.minimum(yy - (y0 - pad), (y0 + rh + pad) - yy) / pad
		m = np.clip(np.minimum(dx, dy), 0, 1)[..., None]
		px[ya:yb, x0:x1, :3] = px[ya:yb, x0:x1, :3] * (1 - m) + block * m
	img.pixels[:] = px.ravel()
	img.update()

def paint_faces(img, boxes):
	"""Blur the texture under the faces inside 3D boxes (canonical frame): markings on those surfaces become unreadable."""
	w, h = img.size
	uv = mesh.uv_layers.active.data
	mask = np.zeros((h, w), dtype=bool)
	n = 0
	for poly in mesh.polygons:
		if not any(inside_any(mesh.vertices[i].co, boxes) for i in poly.vertices):
			continue
		n += 1
		pts = [uv[li].uv for li in poly.loop_indices]
		for k in range(1, len(pts) - 1):
			tri = [(p[0] * w, p[1] * h) for p in (pts[0], pts[k], pts[k + 1])]
			x0 = max(0, int(min(p[0] for p in tri)) - 3); x1 = min(w, int(max(p[0] for p in tri)) + 4)
			y0 = max(0, int(min(p[1] for p in tri)) - 3); y1 = min(h, int(max(p[1] for p in tri)) + 4)
			if x1 <= x0 or y1 <= y0:
				continue
			yy, xx = np.mgrid[y0:y1, x0:x1]
			(ax, ay), (bx, by), (cx, cy) = tri
			d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
			if abs(d) < 1e-9:
				continue
			l1 = ((by - cy) * (xx - cx) + (cx - bx) * (yy - cy)) / d
			l2 = ((cy - ay) * (xx - cx) + (ax - cx) * (yy - cy)) / d
			l3 = 1 - l1 - l2
			e = 3 / max(1.0, min(abs(d) ** 0.5, 50))
			mask[y0:y1, x0:x1] |= (l1 > -e) & (l2 > -e) & (l3 > -e)
	print('PAINT', wid, n, 'faces', int(mask.sum()), 'px')
	if not mask.any():
		return
	px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
	ys, xs = np.nonzero(mask)
	# Blur sizes are given for a 2048 px texture.
	s = w / 2048
	ya, yb, xa, xb = max(0, ys.min() - round(40 * s)), min(h, ys.max() + round(41 * s)), max(0, xs.min() - round(40 * s)), min(w, xs.max() + round(41 * s))
	block = px[ya:yb, xa:xb, :3].copy()
	block[:] = (block @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))[..., None]
	for _ in range(4):
		for axis in (0, 1):
			k = round(15 * s)
			c = np.cumsum(np.pad(block, [(k, k) if i == axis else (0, 0) for i in range(3)], mode='edge'), axis=axis)
			m = block.shape[axis]
			block = (np.take(c, np.arange(2 * k, 2 * k + m), axis=axis) - np.take(c, np.arange(0, m), axis=axis)) / (2 * k)
	sub = mask[ya:yb, xa:xb]
	px[ya:yb, xa:xb, :3][sub] = block[sub]
	img.pixels[:] = px.ravel()
	img.update()

if spec.get('paint') or spec.get('paintFaces'):
	img = tex['base'].image.copy()
	img.name = wid + '-painted'
	if spec.get('paint'):
		paint(img, spec['paint'])
	if spec.get('paintFaces'):
		paint_faces(img, spec['paintFaces'])
	# Pack the edited pixels: a copy of an unpacked image would read the original back.
	img.pack()
	tex['base'].image = img
if '--dump' in sys.argv:
	img = tex['base'].image
	img.filepath_raw = out_fp.replace('.glb', '-base.png')
	img.file_format = 'PNG'
	img.save()

def sized(node, size, name):
	img = node.image.copy()
	img.name = name
	if img.size[0] > size:
		img.scale(size, size)
	node.image = img

# Per-model settings override the shared ones key by key (as build.sh reads them).
fp = {**manifest['fp'], **spec.get('fp', {})}
sized(tex['base'], fp['base'], wid + '-base')
sized(tex['normal'], fp['normal'], wid + '-normal')
sized(tex['orm'], fp['orm'], wid + '-orm')

def export(path):
	bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, use_selection=False,
		export_image_format='AUTO', export_texcoords=True, export_normals=True, export_materials='EXPORT')

export(out_fp)

vs = verts()
print('BOUNDS', wid, [round(min(v[i] for v in vs), 4) for i in range(3)], [round(max(v[i] for v in vs), 4) for i in range(3)], 'tris', sum(len(p.vertices) - 2 for p in mesh.polygons))
