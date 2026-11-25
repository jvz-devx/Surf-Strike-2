/**
 * Dev-only viewer for the first-person weapon and claw models (used with
 * `?mockvm`): draws the ZombieRenderer viewmodel without the game.
 * `&weapon=<WeaponId>`, `&view=fp|side|right|front|top|iso|rear|bottom|left` (`fp` is the game view:
 * same camera, lights, scale and position; the others are orthographic, for
 * judging the shape, `bottom` from below), `&pose=rest|kick|draw|reload|bolt|fire|slash|throw|land|aim|parts` with `&t=` the
 * phase of the pose (0..1; left out: its extreme). `reload`: an empty gun's, `&rounds=1` one with a round left;
 * `bolt`: the sniper's after a shot; `fire`: the fire interval (at most 300 ms) after a shot, `&aim=1` aimed. `aim`: aiming down sights,
 * `t` the linear aim progress as the game keeps it (the pose and the world's
 * field of view take it eased); left out: fully aimed, and for the scoped
 * rifles the moment the scope overlay starts to fade in (the game hides the
 * rifle once fully aimed). The `fp` cells mark the screen centre with a
 * crosshair that has a gap, so a front post in the middle stays visible.
 * `parts`: a moving part of the gun (`&part=slide|bolt|mag|cover|belt|trigger`, several joined
 * with a comma, left out: all of them) `t` along its travel (left out: the end; `&anim=1` runs it to and fro).
 * `&hand=<pose>` (several joined with a comma): the gloved hands in named poses of the weapon (render/hand-poses.ts:
 * grip, grip_off, fore, mag, bolt, cover, knife), following a part that `pose=parts` moves; `open` and `fist` show the
 * right hand alone. `&from=<pose>&blend=0..1`: that far from another pose. `&close=1` frames the hand (the sleeve left out) in an orthographic view, `&hands=0` hides both. `&knife=0` hides the off-hand
 * knife of the claws, `&bg=sky|dark|light`, `&anim=1` loops the pose, `&gen=0` keeps
 * the code-built models (no generated model is loaded, render/weapon-assets.ts).
 * The first frame waits until the generated models of the page have loaded or
 * failed; each first-person label says which model it shows.
 * Contact sheets: `&sheet=weapons` (every weapon in the chosen view and pose),
 * `&sheet=poses` (the pose extremes of one weapon), `&sheet=parts` (each moving part of one
 * gun half-way and at the end), `&sheet=views` (one weapon
 * from every side), `&sheet=aim` (every gun aimed, as `pose=aim` without `t`), `&sheet=reload`, `bolt` and `fire`
 * (twelve phases of one weapon).
 *
 * Third person (`&tp=1`): another player's character holding the weapon, as
 * RemotePlayers draws it (character/held.ts), in the light of the Infected outpost.
 * `&look=infected|alpha` (claws only; a survivor holds everything else), `&view=front|side|iso|rear|left`,
 * `&dist=near|close|300|500|800` (300, 500, 800: that many units away, as big as on a 1080 px high screen),
 * `&duck=1`, `&pitch=<Source degrees, negative looks up>`, `&fire=1` (just fired),
 * `&hits=1` draws the server's hit capsules over the character (heads orange),
 * `&pose=reload&t=0..1` reloads (`t` left out: the magazine in the hand), `&pose=bolt&t=0..1`
 * works the sniper's bolt.
 * Sheets: `&sheet=weapons` (every weapon), `&sheet=looks` (one weapon: its
 * looks standing and ducked, looking up, level and down), `&sheet=views` (one weapon
 * from every side, close and at 300 units), `&sheet=pair` (each held model from the
 * side next to its first-person model; the claws are part of the hands), `&sheet=lineup` (every weapon in one game
 * view at 300 units), `&sheet=reload` (one weapon: six phases of its reload).
 */
import { playerCapsules, WEAPONS as WEAPON_DEFS, type WeaponId } from '@surf/shared';
import * as THREE from 'three';
import { AIM, aimFov, ease, restVmFeel, zoomFov, zoomStep, ZOOM_MS, type VmFeel } from '../game/gunfeel.js';
import { verticalFovFromHorizontal43 } from './fov.js';
import { PART_NAMES, partSteps, type PartName } from './gun-rig.js';
import { handSamples } from './hand-contact.js';
import { blendHands, FREE_POSE_NAMES, type FreePoseName, type PoseName } from './hand-poses.js';
import { skinnedPositions } from './hands.js';
import { SLASH_MS, THROW_MS, VM_KICK, ZombieRenderer } from './zombies.js';
import { defaultLoad, noLoad } from './weapon-assets.js';
import { HELD, HeldAssets } from './character/held.js';
import { BOLT_SECS, RELOADS } from './character/reload.js';
import { emptyPose, RemotePlayers, type InfectedRole } from './players.js';

const WEAPONS: readonly WeaponId[] = ['pistol', 'smg', 'lmg', 'sniper', 'barrett', 'striker', 'knife', 'claws'];
const VIEWS = ['fp', 'side', 'right', 'front', 'top', 'iso', 'rear', 'bottom', 'left'] as const;
const POSES = ['rest', 'kick', 'draw', 'reload', 'bolt', 'fire', 'slash', 'throw', 'land', 'aim', 'parts'] as const;
type View = (typeof VIEWS)[number];
type Pose = (typeof POSES)[number];
/** Knife swing length (ms), as in ZombieRenderer.updateViewmodel. */
const KNIFE_MS = 300;
/** Twelve phases of a reload, a bolt cycle or a shot. */
const PHASES = Array.from({ length: 12 }, (_, i) => (i + 0.5) / 12);
/** What `pose=fire` runs through (ms). */
const fireSpan = (w: WeaponId): number => Math.min(300, WEAPON_DEFS[w].fireMs);
/** Mesh names of the sleeves (render/viewmodels.ts), left out when framing a model. */
const ARM_PARTS = new Set(['sleeve', 'tornSleeve', 'hand']);
/** Guns that aim down sights, in sheet order. */
const AIMED: readonly WeaponId[] = ['pistol', 'smg', 'lmg', 'sniper', 'barrett', 'striker'];
/** Player FOV the viewer aims from (the default `fov` cvar, horizontal at 4:3). */
const VIEW_FOV = 90;
/** Linear aim progress where the scope overlay starts to fade in: SCOPE_OVERLAY_FROM in game/infected.ts. */
const SCOPE_OVERLAY_FROM = 0.6;
/** Whether a weapon zooms through a scope (the game hides it once fully aimed). */
const scoped = (w: WeaponId): boolean => WEAPON_DEFS[w].zoomFov !== null;
/** Linear aim progress of an `aim` cell: its `t`, or fully aimed (scoped rifles: where the overlay starts). */
const aimOf = (c: { weapon: WeaponId; t: number }): number => (Number.isNaN(c.t) ? (scoped(c.weapon) ? SCOPE_OVERLAY_FROM : 1) : Math.max(0, Math.min(1, c.t)));
/** Period of the claw idle motion (ms). */
const IDLE_PERIOD = 2 * Math.PI * 420;

interface Cell {
	/** The part this cell moves (`pose=parts`), else the page's list. */
	part?: PartName;
	weapon: WeaponId;
	view: View;
	pose: Pose;
	/** Phase of the pose, or NaN for its extreme. */
	t: number;
	knife: boolean;
	/** Third person: an avatar holding the weapon. */
	tp?: TpCell;
	/** Third person: the held model alone, from the side (`sheet=pair`). */
	item?: boolean;
	/** Third person: every weapon in one game view (`sheet=lineup`). */
	lineup?: TpCell;
}

const LOOKS = ['survivor', 'infected', 'alpha'] as const;
const TP_VIEWS = ['front', 'side', 'iso', 'rear', 'left'] as const;
type Look = (typeof LOOKS)[number];
type TpView = (typeof TP_VIEWS)[number];

interface TpCell {
	look: Look;
	view: TpView;
	dist: 'near' | 'close' | Far;
	duck: boolean;
	/** Source degrees, negative looks up. */
	pitch: number;
	fire: boolean;
	/** In a reload, or working the bolt, at `t` (0..1). */
	play: 'rest' | 'reload' | 'bolt';
	t: number;
}

/** Six phases of a reload: the gun tipped, the magazine off it, at the belt, the new one on its way, in, and the last part. */
function reloadPhases(w: WeaponId): number[] {
	const m = w === 'claws' ? null : RELOADS[w]?.mag;
	if (!m) return [0];
	return [m.out - 0.03, m.out + 0.07, m.stow > m.out ? m.stow - 0.02 : m.fresh - 0.03, (m.fresh + m.seat) / 2, m.seat, 0.86];
}

/** Direction from the avatar towards the camera (Three axes; the avatar faces +X, its right is +Z). */
const TP_DIRS: Record<TpView, [number, number, number]> = {
	front: [1, 0.1, 0],
	side: [0, 0.1, 1],
	iso: [0.85, 0.35, 0.75],
	rear: [-0.75, 0.3, -0.85],
	left: [0, 0.1, -1]
};
const ROLE: Record<Look, InfectedRole> = { survivor: 'none', infected: 'infected', alpha: 'alpha' };
/** Screen height the 300 unit views match (px). */
const REF_SCREEN_H = 1080;
/** Game distances of the third-person views (units). */
const FAR = ['300', '500', '800'] as const;
type Far = (typeof FAR)[number];
const isFar = (d: string): d is Far => (FAR as readonly string[]).includes(d);

/** Camera direction (from the model towards the camera) and up vector of the orthographic views. */
const ORTHO: Record<Exclude<View, 'fp'>, { dir: [number, number, number]; up: [number, number, number] }> = {
	side: { dir: [-1, 0, 0], up: [0, 1, 0] },
	right: { dir: [1, 0, 0], up: [0, 1, 0] },
	front: { dir: [0, 0, -1], up: [0, 1, 0] },
	top: { dir: [0, 1, 0], up: [0, 0, -1] },
	iso: { dir: [-1, 0.7, -1], up: [0, 1, 0] },
	rear: { dir: [0.8, 0.7, 1], up: [0, 1, 0] },
	bottom: { dir: [0, -1, 0], up: [0, 0, -1] },
	left: { dir: [-0.8, 0.5, 1], up: [0, 1, 0] }
};

const BACKDROPS = {
	sky: { sky: 0x9fd3ff, ground: 0x5a6470, wall: 0x8a8f98, flat: 0x6f7985 },
	dark: { sky: 0x14161c, ground: 0x1c1e24, wall: 0x2a2d35, flat: 0x202329 },
	light: { sky: 0xf4f7fb, ground: 0xd8dde4, wall: 0xc2c8d0, flat: 0xe6eaef }
} as const;

/** Label part of an `aim` cell: the aim progress, and for the scoped rifles the scope overlay's opacity. */
function aimNote(c: Cell): string {
	if (c.pose !== 'aim' || !AIMED.includes(c.weapon)) return '';
	const t = aimOf(c);
	const overlay = scoped(c.weapon) ? ` · scope overlay ${Math.round(ease((t - SCOPE_OVERLAY_FROM) / (1 - SCOPE_OVERLAY_FROM)) * 100)}%` : '';
	// A cell without its own t shows the progress it stands for.
	return `${Number.isNaN(c.t) ? ` ${t}` : ''}${overlay}`;
}

const isOneOf = <T extends string>(list: readonly T[], v: string | null): v is T => v !== null && (list as readonly string[]).includes(v);

/** The pose extremes shown by `sheet=poses`. */
function poseCells(weapon: WeaponId, view: View): Cell[] {
	const c = (pose: Pose, t = NaN, knife = true): Cell => ({ weapon, view, pose, t, knife });
	if (weapon === 'claws')
		return [
			c('rest'),
			c('rest', NaN, false),
			c('slash', 0.2),
			c('slash', 0.35),
			c('slash', 0.5),
			c('slash', 0.65),
			c('slash', 0.85),
			c('throw', 0.15),
			c('throw', 0.3),
			c('throw', 0.42),
			c('throw', 0.5),
			c('throw', 0.75),
			c('draw', 0.5),
			c('draw', 0.8),
			c('draw', 1),
			c('land')
		];
	if (weapon === 'knife') return [c('rest'), c('slash', 0.1), c('slash', 0.3), c('slash', 0.5), c('slash', 0.8), c('draw', 0.5), c('draw', 0.8), c('draw', 1), c('land')];
	return [
		c('rest'),
		c('kick'),
		c('kick', 0.3),
		c('draw', 0.3),
		c('draw', 0.6),
		c('draw', 1),
		c('reload', 0.12),
		c('reload', 0.24),
		c('reload', 0.4),
		c('reload', 0.58),
		c('reload', 0.88),
		c('land'),
		c('aim', 0.25),
		c('aim', 0.5),
		c('aim', 0.75),
		c('aim', 1)
	];
}

export function createViewmodelViewer(canvas: HTMLCanvasElement): { destroy(): void } {
	const params = new URLSearchParams(location.search);
	const pick = <T extends string>(name: string, list: readonly T[], fallback: T): T => {
		const v = params.get(name);
		return isOneOf(list, v) ? v : fallback;
	};
	const weapon = pick('weapon', WEAPONS, 'pistol');
	const view = pick('view', VIEWS, 'fp');
	const pose = pick('pose', POSES, 'rest');
	const t = params.has('t') ? Number(params.get('t')) : NaN;
	const knife = params.get('knife') !== '0';
	const anim = params.get('anim') === '1';
	const bg = BACKDROPS[pick('bg', ['sky', 'dark', 'light'] as const, 'sky')];
	const sheet = params.get('sheet');
	/** Parts moved by `pose=parts`: these, or all the gun has. */
	const partList = (params.get('part') ?? '').split(',').filter((p): p is PartName => isOneOf(PART_NAMES, p));
	/** Named hand poses to show in place of the rest poses, and the one they are blended from. */
	const handList = (params.get('hand') ?? '').split(',').filter((h) => h);
	const handFrom = params.get('from');
	const handBlend = Number(params.get('blend') ?? 1);
	const close = params.get('close') === '1';
	const noHands = params.get('hands') === '0';
	/** `pose=fire` aimed. */
	const aimed = params.get('aim') === '1';
	/** Rounds in the magazine (left out: plenty; a reload of an empty gun). */
	const rounds = params.has('rounds') ? Number(params.get('rounds')) : null;
	const tpMode = params.get('tp') === '1';
	const tpBase: TpCell = {
		look: pick('look', LOOKS, weapon === 'claws' ? 'infected' : 'survivor'),
		view: pick('view', TP_VIEWS, 'iso'),
		dist: pick('dist', ['near', 'close', ...FAR] as const, 'close'),
		duck: params.get('duck') === '1',
		pitch: Number(params.get('pitch') ?? 0) || 0,
		fire: params.get('fire') === '1',
		play: pick('pose', ['rest', 'reload', 'bolt'] as const, 'rest'),
		t
	};
	/** Claws belong to the infected, everything else to a survivor. */
	const tpLook = (w: WeaponId, look: Look): Look => (w !== 'claws' ? 'survivor' : look === 'survivor' ? 'infected' : look);
	const tpCell = (w: WeaponId, o: Partial<TpCell> = {}): Cell => {
		const tp = { ...tpBase, ...o };
		if (Number.isNaN(tp.t)) tp.t = tp.play === 'reload' ? reloadPhases(w)[3] ?? 0 : 0.5;
		return { weapon: w, view: 'side', pose: 'rest', t: NaN, knife, tp: { ...tp, look: tpLook(w, tp.look) } };
	};
	const cells: Cell[] = tpMode
		? sheet === 'weapons'
			? WEAPONS.map((w) => tpCell(w))
			: sheet === 'looks'
				? LOOKS.filter((look) => look === tpLook(weapon, look)).flatMap((look) => [false, true].flatMap((duck) => [-40, 0, 40].map((pitch) => tpCell(weapon, { look, duck, pitch }))))
				: sheet === 'views'
					? (['close', '300'] as const).flatMap((dist) => (['front', 'side', 'iso', 'rear'] as const).map((view) => tpCell(weapon, { view, dist })))
					: sheet === 'pair'
						? (Object.keys(HELD) as (keyof typeof HELD)[]).flatMap((w): Cell[] => [
								{ weapon: w, view: 'side', pose: 'rest', t: NaN, knife },
								{ weapon: w, view: 'side', pose: 'rest', t: NaN, knife, item: true }
							])
						: sheet === 'reload'
							? reloadPhases(weapon).map((p) => tpCell(weapon, { play: 'reload', t: p }))
							: sheet === 'lineup'
								? [{ weapon, view: 'side', pose: 'rest', t: NaN, knife, lineup: { ...tpBase, dist: isFar(tpBase.dist) ? tpBase.dist : '300' } }]
								: [tpCell(weapon)]
		: sheet === 'weapons'
			? WEAPONS.map((w) => ({ weapon: w, view, pose, t, knife }))
			: sheet === 'aim'
				? AIMED.map((w) => ({ weapon: w, view, pose: 'aim' as const, t, knife }))
				: sheet === 'reload' || sheet === 'bolt' || sheet === 'fire'
					? PHASES.map((t): Cell => ({ weapon, view, pose: sheet, t, knife }))
				: sheet === 'parts'
					? PART_NAMES.filter((p) => partSteps(weapon, p).length).flatMap((part) => [0.5, 1].map((t): Cell => ({ weapon, view, pose: 'parts', t, knife, part })))
				: sheet === 'poses'
					? poseCells(weapon, view)
					: sheet === 'views'
						? VIEWS.map((v) => ({ weapon, view: v, pose, t, knife }))
						: [{ weapon, view, pose, t, knife }];

	// Renderer set up like GameRenderer, so `fp` matches the game pixel for pixel.
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.autoClear = false;
	renderer.setScissorTest(true);
	const load = params.get('gen') === '0' ? noLoad : defaultLoad;
	const assets = new HeldAssets();
	const zr = new ZombieRenderer(assets, load);
	zr.useRenderer(renderer);
	const feel: VmFeel = restVmFeel();

	// A plain world behind the `fp` view: sky, floor and a few blocks at fighting distance.
	const world = new THREE.Scene();
	world.background = new THREE.Color(bg.sky);
	world.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
	const worldCam = new THREE.PerspectiveCamera(verticalFovFromHorizontal43(90), 16 / 9, 2, 250000);
	worldCam.position.set(0, 64, 0);
	const unit = new THREE.BoxGeometry(1, 1, 1);
	const worldMats = [new THREE.MeshLambertMaterial({ color: bg.ground }), new THREE.MeshLambertMaterial({ color: bg.wall })];
	const block = (m: number, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
		const b = new THREE.Mesh(unit, worldMats[m]);
		b.scale.set(sx, sy, sz);
		b.position.set(x, y, z);
		world.add(b);
	};
	block(0, 8000, 2, 8000, 0, -1, 0);
	block(1, 600, 220, 40, 0, 110, -900);
	block(1, 40, 160, 500, -420, 80, -600);
	block(1, 120, 96, 120, 260, 48, -420);
	block(1, 64, 64, 64, -120, 32, -300);

	/** World FOV of a cell (horizontal at 4:3): zoomed over the end of the aim of a gun, as in the game. */
	const worldFov = (c: Cell): number =>
		c.pose === 'aim' && AIMED.includes(c.weapon)
			? zoomFov(VIEW_FOV, aimFov(VIEW_FOV, c.weapon), ease(zoomStep(aimOf(c), AIM[c.weapon]?.aimMs ?? ZOOM_MS)))
			: VIEW_FOV;

	const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
	const box = new THREE.Box3();
	const centre = new THREE.Vector3();
	const V = new THREE.Vector3();
	const RIGHT = new THREE.Vector3();
	const UP = new THREE.Vector3();
	const flat = new THREE.Color(bg.flat);

	/** The weapon group that is visible in the viewmodel (the flash is a mesh, not a group). */
	const model = (): THREE.Object3D | null => {
		const vm = zr.vmScene.children.find((c): c is THREE.Group => c instanceof THREE.Group);
		return vm?.children.find((c) => c.visible && c instanceof THREE.Group) ?? null;
	};

	/** Put the viewmodel in the pose of a cell at `now` (ms); stateless, so every frame can call it. */
	const applyPose = (c: Cell, now: number): void => {
		zr.clear();
		zr.setWeapon(c.weapon);
		zr.setOffhandKnife(c.weapon === 'claws' && c.knife, now - 1000);
		Object.assign(feel, restVmFeel());
		const melee = c.weapon === 'knife' || c.weapon === 'claws';
		let reload = 1;
		let at = now;
		const pose = melee && c.pose === 'kick' ? 'slash' : !melee && c.pose === 'slash' ? 'kick' : c.pose;
		if (pose === 'kick' || pose === 'slash') {
			// The largest twist of a shot: the random roll is pinned for the screenshot.
			const random = Math.random;
			Math.random = () => 1;
			zr.fired(now);
			Math.random = random;
			if (melee) at = now + (Number.isNaN(c.t) ? 0.5 : c.t) * (c.weapon === 'claws' ? SLASH_MS : KNIFE_MS);
			else {
				const k = VM_KICK[c.weapon] ?? { ms: 170, attack: 16 };
				at = now + (Number.isNaN(c.t) ? k.attack : c.t * k.ms);
			}
		} else if (pose === 'draw') feel.lower = Number.isNaN(c.t) ? 0.5 : c.t;
		else if (pose === 'reload') reload = Number.isNaN(c.t) ? 0.4 : c.t;
		else if (pose === 'bolt' || pose === 'fire') {
			// Just fired: the bolt clip of the sniper, or the cycle of the others over their fire interval.
			zr.fired(now);
			at = now + (Number.isNaN(c.t) ? (pose === 'bolt' ? 0.5 : 0.1) : c.t) * (pose === 'bolt' ? BOLT_SECS * 1000 : fireSpan(c.weapon));
			if (aimed) feel.aim = 1;
		}
		else if (pose === 'throw') {
			zr.thrown(now);
			zr.setOffhandKnife(false, now);
			at = now + (Number.isNaN(c.t) ? 0.3 : c.t) * THROW_MS;
		} else if (pose === 'land') feel.land = 1;
		else if (pose === 'aim') feel.aim = melee ? 0 : ease(aimOf(c));
		zr.updateViewmodel(at, true, reload, 0, feel, rounds ?? (pose === 'reload' ? 0 : undefined));
		const rig = zr.rig(c.weapon);
		if (pose === 'parts' || handList.length) rig?.reset();
		if (rig && pose === 'parts') for (const p of c.part ? [c.part] : partList.length ? partList : rig.names) rig.move(p, Number.isNaN(c.t) ? 1 : c.t);
		const pair = zr.hands(c.weapon);
		const gun = model();
		const free = handList.find((h): h is FreePoseName => isOneOf(FREE_POSE_NAMES, h));
		gun?.traverse((o) => {
			if (o.name === 'gun' || o.name === 'dot') o.visible = !free;
		});
		if (pose === 'parts' || handList.length) pair?.rest();
		if (noHands && pair) for (const s of ['r', 'l'] as const) pair.set(s, null);
		for (const h of handList) {
			const to = pair?.named(h as PoseName);
			const place = to && pair!.pose(h as PoseName);
			if (!to || !place) continue;
			const from = handFrom ? pair!.pose(handFrom as PoseName) : null;
			pair!.set(to.side, from ? blendHands(from, place, handBlend) : place);
		}
		if (free && pair) {
			pair.set('l', null);
			pair.shape('r', free);
		}
	};

	/** Frame the orthographic camera on the rest pose of the model, seen from `view`. */
	const frame = (c: Cell, aspect: number, now: number): void => {
		applyPose({ ...c, pose: 'rest', t: NaN }, now);
		zr.vmScene.updateMatrixWorld(true);
		const m = model();
		if (!m) return;
		// Frame the weapon itself: the forearms run far out of the picture.
		box.makeEmpty();
		const shown = handList.map((h) => (isOneOf(FREE_POSE_NAMES, h) ? 'r' : zr.hands(c.weapon)?.named(h as PoseName)?.side)).find((s) => s);
		if (close && shown) {
			applyPose(c, now);
			zr.vmScene.updateMatrixWorld(true);
			const mesh = zr.hands(c.weapon)!.hands[shown].mesh;
			const at = skinnedPositions(mesh);
			for (const s of handSamples(mesh)) if (!s.arm) box.expandByPoint(V.fromArray(at, s.vertex * 3));
			return fitOrtho(ORTHO[c.view as Exclude<View, 'fp'>], aspect);
		}
		m.traverse((o) => {
			if (o instanceof THREE.Mesh && !ARM_PARTS.has(o.name) && o.parent?.visible !== false) box.expandByObject(o);
		});
		if (box.isEmpty()) box.setFromObject(m);
		fitOrtho(ORTHO[c.view as Exclude<View, 'fp'>], aspect);
	};

	/** Point the orthographic camera at `box` from `o.dir` and fit the box in the picture. */
	const fitOrtho = (o: { dir: [number, number, number]; up: [number, number, number] }, aspect: number): void => {
		box.getCenter(centre);
		ortho.up.set(...o.up);
		ortho.position.set(...o.dir).normalize().multiplyScalar(300).add(centre);
		ortho.lookAt(centre);
		ortho.updateMatrixWorld(true);
		RIGHT.setFromMatrixColumn(ortho.matrixWorld, 0);
		UP.setFromMatrixColumn(ortho.matrixWorld, 1);
		let hw = 0;
		let hh = 0;
		for (let i = 0; i < 8; i++) {
			V.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(centre);
			hw = Math.max(hw, Math.abs(V.dot(RIGHT)));
			hh = Math.max(hh, Math.abs(V.dot(UP)));
		}
		const half = Math.max(hh, hw / aspect) * 1.25;
		ortho.left = -half * aspect;
		ortho.right = half * aspect;
		ortho.top = half;
		ortho.bottom = -half;
		ortho.updateProjectionMatrix();
	};

	// Third person: avatars in the light of the Infected outpost (render/renderer.ts loadMap), on sand.
	const tpScene = new THREE.Scene();
	tpScene.background = new THREE.Color(0xa9c6e4);
	const hemi = new THREE.HemisphereLight(0xf0d9b0, 0x9a7448, 0.7 * Math.PI * 0.5);
	const sun = new THREE.DirectionalLight(0xffd48a, 1.45);
	sun.position.set(0.42, 0.85, 0.32).multiplyScalar(1000);
	const sand = new THREE.Mesh(unit, new THREE.MeshLambertMaterial({ color: 0xd2b589 }));
	sand.scale.set(4000, 2, 4000);
	sand.position.y = -1;
	tpScene.add(hemi, sun, sand);
	const players = new RemotePlayers(assets);
	tpScene.add(players.group);
	const tpCam = new THREE.PerspectiveCamera(40, 16 / 9, 1, 20000);
	// The held model alone, for `sheet=pair`: in white light, to compare colours with the first-person model.
	const itemScene = new THREE.Scene();
	const itemSun = new THREE.DirectionalLight(0xffffff, 1.6);
	itemSun.position.set(-0.4, 0.9, -0.5);
	itemScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6), itemSun);
	const item = new THREE.Mesh(assets.geometry('pistol'), assets.material);
	itemScene.add(item);
	let avatars = 0;
	const avatarPose = emptyPose();
	/** Character `id` at a Source position, facing +X, posed for a cell. */
	const poseAvatar = (id: number, w: WeaponId, tp: TpCell, x: number, y: number, now = 0): void => {
		while (avatars < id) players.upsert(++avatars, `P${avatars}`);
		const look = tp.look;
		players.setInfected(id, ROLE[look]);
		players.setHeld(id, w, look !== 'survivor');
		// The viewer's clock jumps: a reload that stands at `t` starts anew in every frame.
		const ms = WEAPON_DEFS[w].reloadMs;
		if (tp.play === 'reload') players.reload(id, w, now - Math.min(0.9999, tp.t) * ms, ms);
		players.setTagVisible(id, false);
		avatarPose.x = x;
		avatarPose.y = y;
		avatarPose.ducked = tp.duck;
		avatarPose.pitch = tp.pitch;
		players.setPose(id, avatarPose, true);
	};
	/** Animate the shown characters; the first time until the pose stands. `fire`: just fired. */
	const settled = new Set<Cell>();
	const animate = (c: Cell, ids: readonly number[], tp: TpCell, now: number): void => {
		const dist = isFar(tp.dist) ? Number(tp.dist) : 100;
		const view = { dt: 1 / 30, distance: () => dist };
		// Every cell's avatars are hidden in between: a reload comes in again in every frame, a bolt cycle runs again.
		for (let i = !settled.has(c) ? 60 : tp.play === 'reload' ? 6 : 1; i > 0; i--) players.update(view, now);
		if (tp.play === 'bolt') {
			for (const id of ids) players.act(id, 'fire');
			view.dt = (tp.t * BOLT_SECS) / 20;
			for (let i = 0; i < 20; i++) players.update(view, now);
		}
		settled.add(c);
		if (!tp.fire) return;
		for (const id of ids) players.fired(id, now);
		players.update({ dt: 0.02, distance: () => dist }, now);
	};
	const hideAvatars = (): void => {
		for (let id = 1; id <= avatars; id++) players.setPose(id, avatarPose, false);
	};
	/** `hits=1`: the hit capsules of a character, see-through over it. */
	const hits = params.get('hits') === '1';
	const hitGroup = new THREE.Group();
	const hitMat = (color: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false });
	const hitMats = { head: hitMat(0xff8a1e), body: hitMat(0x1ec8ff) };
	tpScene.add(hitGroup);
	const drawHits = (w: WeaponId, tp: TpCell): void => {
		for (const o of hitGroup.children) (o as THREE.Mesh).geometry.dispose();
		hitGroup.clear();
		if (!hits) return;
		for (const c of playerCapsules({ x: 0, y: 0, z: 0, yaw: 0, ducked: tp.duck, hunched: tp.look !== 'survivor', held: w, pitch: tp.pitch })) {
			const a = new THREE.Vector3(c.a.x, c.a.z, -c.a.y);
			const d = new THREE.Vector3(c.b.x, c.b.z, -c.b.y).sub(a);
			const m = new THREE.Mesh(new THREE.CapsuleGeometry(c.r, d.length(), 6, 12), c.part === 'head' ? hitMats.head : hitMats.body);
			m.position.copy(a).addScaledVector(d, 0.5);
			m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
			m.renderOrder = 10;
			hitGroup.add(m);
		}
	};
	/** Camera at `dist` from the chest of an avatar at Three `(0, 0, z)`; at 300 units and more the picture keeps the scale of a REF_SCREEN_H screen. */
	const placeTp = (tp: TpCell, aspect: number, ch: number, z = 0): void => {
		const d = TP_DIRS[tp.view];
		const far = isFar(tp.dist);
		const target = tp.dist === 'near' ? new THREE.Vector3(16, 46 * (tp.duck ? 0.8 : 1), z + 4) : new THREE.Vector3(4, (far ? 64 : 48) * (tp.duck ? 0.85 : 1), z);
		tpCam.position.set(...d).normalize().multiplyScalar(far ? Number(tp.dist) : tp.dist === 'near' ? 55 : 120).add(target);
		if (far) tpCam.position.y = Math.max(tpCam.position.y, 64);
		tpCam.lookAt(target);
		const game = (verticalFovFromHorizontal43(90) * Math.PI) / 180;
		tpCam.fov = far ? (2 * Math.atan(Math.tan(game / 2) * (ch / REF_SCREEN_H)) * 180) / Math.PI : 42;
		tpCam.aspect = aspect;
		tpCam.updateProjectionMatrix();
	};
	const drawTp = (c: Cell, aspect: number, ch: number, now: number): void => {
		hideAvatars();
		hitGroup.visible = !c.lineup;
		if (c.lineup) {
			// Every weapon side by side, 70 units apart across the view, seen from 300 units or more in the game's field of view.
			const d = TP_DIRS[c.lineup.view];
			const across = new THREE.Vector3(-d[2], 0, d[0]).normalize();
			WEAPONS.forEach((w, i) => {
				const k = (i - (WEAPONS.length - 1) / 2) * 70;
				const lt = c.lineup!;
				const t = Number.isNaN(lt.t) ? reloadPhases(w)[3] ?? 0 : lt.t;
				poseAvatar(i + 1, w, { ...lt, t, look: tpLook(w, lt.look) }, across.x * k, -across.z * k, now);
			});
			animate(
				c,
				WEAPONS.map((_, i) => i + 1),
				c.lineup,
				now
			);
			const target = new THREE.Vector3(0, 50, 0);
			tpCam.position.set(...d).normalize().multiplyScalar(Number(c.lineup.dist)).add(target);
			tpCam.position.y = Math.max(tpCam.position.y, 64);
			tpCam.lookAt(target);
			tpCam.fov = verticalFovFromHorizontal43(90);
			tpCam.aspect = aspect;
			tpCam.updateProjectionMatrix();
		} else {
			const id = cells.indexOf(c) + 1;
			poseAvatar(id, c.weapon, c.tp!, 0, 0, now);
			animate(c, [id], c.tp!, now);
			drawHits(c.weapon, c.tp!);
			placeTp(c.tp!, aspect, ch);
		}
		renderer.render(tpScene, tpCam);
	};
	const drawItem = (c: Cell, aspect: number): void => {
		if (c.weapon === 'claws') return;
		item.geometry = assets.geometry(c.weapon);
		itemScene.updateMatrixWorld(true);
		box.makeEmpty().expandByObject(item);
		// From the player's left, like the first-person side view: the muzzle points left.
		fitOrtho({ dir: [0, 0, -1], up: [0, 1, 0] }, aspect);
		renderer.setClearColor(flat, 1);
		renderer.clear();
		renderer.render(itemScene, ortho);
	};

	// Labels and crosshairs sit in a DOM overlay over the canvas.
	const overlay = document.createElement('div');
	overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;font:12px/1.2 ui-monospace,monospace;color:#fff';
	canvas.parentElement?.append(overlay);
	const cols = Math.ceil(Math.sqrt(cells.length));
	const labels: [HTMLSpanElement, Cell][] = [];
	for (const [i, c] of cells.entries()) {
		const el = document.createElement('div');
		// Every cell keeps the aspect of the window (cols × cols grid of equal cells).
		el.style.cssText = `position:absolute;left:${((i % cols) * 100) / cols}%;top:${(Math.floor(i / cols) * 100) / cols}%;width:${100 / cols}%;height:${100 / cols}%;box-sizing:border-box;${cells.length > 1 ? 'border:1px solid #0008;' : ''}`;
		const label = document.createElement('span');
		label.textContent = c.tp
			? `${c.weapon} · ${c.tp.look} · ${c.tp.view} · ${c.tp.dist}${c.tp.duck ? ' · ducked' : ''} · pitch ${c.tp.pitch}${c.tp.play === 'rest' ? '' : ` · ${c.tp.play} ${c.tp.t.toFixed(2)}`}`
			: c.item
				? `${c.weapon} · third person · side`
				: c.lineup
					? `lineup · ${c.lineup.look} · ${c.lineup.view} · ${c.lineup.dist} units`
					: `${c.weapon} · ${c.view} · ${c.pose}${Number.isNaN(c.t) ? '' : ' ' + c.t}${c.pose === 'parts' ? ' · ' + (c.part ?? (partList.join(',') || 'all')) : ''}${handList.length && !c.tp ? ' · hand ' + handList.join(',') : ''}${c.weapon === 'claws' && !c.knife ? ' · no knife' : ''}${aimNote(c)}`;
		label.style.cssText = 'position:absolute;left:6px;top:4px;padding:1px 4px;background:#000a;border-radius:2px';
		labels.push([label, c]);
		el.append(label);
		if (c.view === 'fp') {
			// Four ticks around an open middle: the screen centre is the middle of the gap.
			const cross = document.createElement('span');
			const g = 'linear-gradient(#3f6,#3f6)';
			cross.style.cssText = `position:absolute;left:50%;top:50%;width:30px;height:30px;margin:-15px 0 0 -15px;background:${g} left center/10px 1px no-repeat,${g} right center/10px 1px no-repeat,${g} center top/1px 10px no-repeat,${g} center bottom/1px 10px no-repeat`;
			el.append(cross);
		}
		overlay.append(el);
	}

	const t0 = performance.now();
	// Still poses use a clock that only moves forward in whole periods of the claw idle
	// motion: equal frames, and no muzzle flash left over from the cell before.
	let clock = 0;
	let raf = 0;
	const draw = () => {
		const w = Math.max(1, canvas.clientWidth);
		const h = Math.max(1, canvas.clientHeight);
		const size = renderer.getSize(new THREE.Vector2());
		if (size.x !== w || size.y !== h) {
			renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			renderer.setSize(w, h, false);
		}
		const cw = w / cols;
		const ch = h / cols;
		renderer.setViewport(0, 0, w, h);
		renderer.setScissor(0, 0, w, h);
		renderer.setClearColor(0x101216, 1);
		renderer.clear();
		const elapsed = performance.now() - t0;
		for (const [i, c] of cells.entries()) {
			const x = (i % cols) * cw;
			const y = h - (Math.floor(i / cols) + 1) * ch;
			renderer.setViewport(x, y, cw, ch);
			renderer.setScissor(x, y, cw, ch);
			clock += IDLE_PERIOD * 4;
			const now = clock;
			const cell = anim ? { ...c, t: Math.min(1, (elapsed % 1600) / 1000) } : c;
			zr.resize(cw / ch);
			if (c.tp || c.lineup) drawTp(c, cw / ch, ch, now);
			else if (c.item) drawItem(c, cw / ch);
			else if (c.view === 'fp') {
				applyPose(cell, now);
				// Aimed, the world zooms as in the game (Game.zoomProgress); the viewmodel camera keeps its field of view.
				worldCam.fov = verticalFovFromHorizontal43(worldFov(cell));
				worldCam.aspect = cw / ch;
				worldCam.updateProjectionMatrix();
				renderer.render(world, worldCam);
				// As GameRenderer.render: the viewmodel over the world with a cleared depth buffer.
				renderer.clearDepth();
				renderer.render(zr.vmScene, zr.vmCamera);
			} else {
				frame(c, cw / ch, now);
				applyPose(cell, now);
				renderer.setClearColor(flat, 1);
				renderer.clear();
				renderer.render(zr.vmScene, ortho);
			}
		}
		document.documentElement.dataset.vmReady = '1';
		raf = requestAnimationFrame(draw);
	};
	// The first frame waits for the generated first-person models of the page: a screenshot never shows a fallback by accident.
	const ids = [...new Set(cells.flatMap((c): WeaponId[] => (c.tp || c.lineup || c.item ? [] : [c.weapon])))];
	let gone = false;
	void zr.preload(ids).then(() => {
		if (gone) return;
		for (const [label, c] of labels) {
			if (c.tp || c.lineup || c.item || c.weapon === 'claws') continue;
			label.textContent += zr.generatedShown(c.weapon) ? (zr.hands(c.weapon) ? ' · generated' : ' · generated, box hands') : ' · code-built';
		}
		raf = requestAnimationFrame(draw);
	});

	return {
		destroy() {
			gone = true;
			cancelAnimationFrame(raf);
			overlay.remove();
			zr.dispose();
			players.dispose();
			for (const o of hitGroup.children) (o as THREE.Mesh).geometry.dispose();
			for (const m of Object.values(hitMats)) m.dispose();
			assets.dispose();
			(sand.material as THREE.Material).dispose();
			unit.dispose();
			for (const m of worldMats) m.dispose();
			renderer.dispose();
			renderer.forceContextLoss();
			delete document.documentElement.dataset.vmReady;
		}
	};
}
