/**
 * The first-person animations on the shipped guns (render/fp-anim.ts, ZombieRenderer.updateViewmodel): parts and hands
 * follow the clips, a shot cycles the gun, a move that is cut short blends out in time and leaves nothing behind, and the
 * hands never jump.
 */
import { WEAPONS } from '@surf/shared';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { restVmFeel } from '../game/gunfeel.js';
import { HeldAssets } from './character/held.js';
import { CANCEL_MS } from './fp-anim.js';
import { BELT_MS, BELT_ROUNDS, CYCLES, FP_RELOADS } from './fp-clips.js';
import { GUN_PARTS, type GunId } from './gun-rig.js';
import { shippedLoad } from './shipped-models.js';
import { noLoad } from './weapon-assets.js';
import { ZombieRenderer } from './zombies.js';

const GUNS = Object.keys(GUN_PARTS) as GunId[];
/** Fastest a hand may move in the picture (model units/s) at the normal reload time: about 3.7 m/s, 2.8 m/s on the LMG, whose reload leaves the time. */
const HAND_SPEED = 160;
const LMG_SPEED = 120;

async function gun(id: GunId): Promise<ZombieRenderer> {
	const z = new ZombieRenderer(new HeldAssets(), shippedLoad);
	z.setWeapon(id);
	await z.preload([id]);
	z.updateViewmodel(0, true, 1, 0, restVmFeel(), WEAPONS[id].magazine);
	return z;
}
/** Where every part and both hands are. */
function state(z: ZombieRenderer, id: GunId) {
	const rig = z.rig(id)!;
	const pair = z.hands(id)!;
	const parts = Object.fromEntries(rig.names.map((n) => [n, { p: rig.part(n)!.position.clone(), q: rig.part(n)!.quaternion.clone(), on: rig.part(n)!.visible }]));
	const hand = (s: 'l' | 'r') => ({ p: pair.hands[s].group.position.clone(), q: pair.hands[s].group.quaternion.clone(), on: pair.hands[s].group.visible });
	return { parts, l: hand('l'), r: hand('r'), gun: [...z.anim.gun] };
}
type State = ReturnType<typeof state>;
function same(a: State, b: State, label: string): void {
	for (const [n, p] of Object.entries(a.parts)) {
		expect(p.p.distanceTo(b.parts[n]!.p), label + ' ' + n).toBeLessThan(1e-6);
		expect(p.q.angleTo(b.parts[n]!.q), label + ' ' + n).toBeLessThan(1e-4);
		expect(p.on, label + ' ' + n).toBe(b.parts[n]!.on);
	}
	for (const s of ['l', 'r'] as const) {
		expect(a[s].on, label + ' ' + s).toBe(b[s].on);
		if (a[s].on) expect(a[s].p.distanceTo(b[s].p), label + ' ' + s).toBeLessThan(1e-5);
	}
	a.gun.forEach((v, i) => expect(v, label).toBeCloseTo(b.gun[i]!, 6));
}

describe('reload', () => {
	it.each(GUNS)('%s: ends where it began, the magazine gone and back in between, at the real reload time and half of it', async (id) => {
		const z = await gun(id);
		for (const empty of [true, false]) {
			const rest = state(z, id);
			const ms = WEAPONS[id].reloadMs;
			let gone = false;
			for (let i = 0; i < 100; i++) {
				z.updateViewmodel((i / 100) * ms, true, i / 100, 0, restVmFeel(), empty ? 0 : 3);
				if (!z.rig(id)!.part('mag')!.visible) gone = true;
			}
			expect(gone).toBe(true);
			z.updateViewmodel(ms + 1, true, 1, 0, restVmFeel(), WEAPONS[id].magazine);
			z.updateViewmodel(ms + 2 * CANCEL_MS, true, 1, 0, restVmFeel(), WEAPONS[id].magazine);
			same(state(z, id), rest, id);
		}
		z.dispose();
	});

	it.each(GUNS)('%s: the hands never jump', async (id) => {
		const z = await gun(id);
		for (const empty of [true, false]) {
			const ms = WEAPONS[id].reloadMs;
			const N = 1200;
			let prev: State | null = null;
			for (let i = 0; i < N; i++) {
				z.updateViewmodel(20_000 + (i / N) * ms, true, i / N, 0, restVmFeel(), empty ? 0 : 3);
				const s = state(z, id);
				if (prev) for (const h of ['l', 'r'] as const) if (s[h].on && prev[h].on) expect((s[h].p.distanceTo(prev[h].p) * N * 1000) / ms, h + ' at ' + (i / N).toFixed(3)).toBeLessThan(id === 'lmg' ? LMG_SPEED : HAND_SPEED);
				prev = s;
			}
			z.updateViewmodel(40_000, true, 1, 0, restVmFeel(), 5);
			z.updateViewmodel(41_000, true, 1, 0, restVmFeel(), 5);
		}
		z.dispose();
	}, 60_000);

	it('the hand stays on the knob, the handle, the slide and the cover while it works them, and opens when it lets go', async () => {
		for (const [id, pose, times] of [
			// The bolt lifted, pulled, pushed and turned down; the handles and the slide pulled; the cover up and down.
			['sniper', 'bolt', [0.09, 0.11, 0.13, 0.16, 0.83, 0.87, 0.91]],
			['lmg', 'bolt', [0.925, 0.94, 0.949]],
			['barrett', 'bolt', [0.825, 0.85, 0.869]],
			['pistol', 'bolt', [0.77, 0.8, 0.829]],
			['lmg', 'cover', [0.11, 0.15, 0.2, 0.81, 0.84, 0.86]]
		] as const) {
			const z = await gun(id);
			const pair = z.hands(id)!;
			const side = pair.named(pose)!.side;
			for (const t of times) {
				z.updateViewmodel(0, true, t, 0, restVmFeel(), 0);
				const p = pair.pose(pose, pose === 'cover' ? 'cover' : undefined)!;
				expect(pair.hands[side].group.position.distanceTo(new THREE.Vector3(...p.p)), id + ' ' + pose + ' ' + t).toBeLessThan(1e-6);
				expect(pair.hands[side].group.quaternion.angleTo(new THREE.Quaternion(...p.q)), id + ' ' + pose + ' ' + t).toBeLessThan(0.01);
			}
			z.dispose();
		}
		const bolt = await gun('sniper');
		bolt.fired(1000);
		for (const t of [0.31, 0.39, 0.5, 0.57, 0.7, 0.83]) {
			bolt.updateViewmodel(1000 + t * 900, true, 1, 0, restVmFeel(), 3);
			expect(bolt.hands('sniper')!.hands.r.group.position.distanceTo(new THREE.Vector3(...bolt.hands('sniper')!.pose('bolt')!.p)), String(t)).toBeLessThan(1e-6);
		}
		bolt.dispose();
		// The slide flies home out of an open hand, which stays behind where it let go.
		const z = await gun('pistol');
		const pair = z.hands('pistol')!;
		const bend = () => pair.hands.l.mesh.skeleton.bones.filter((b) => /^(index|middle)[12]$/.test(b.name)).reduce((s, b) => s + 2 * Math.acos(Math.min(1, Math.abs(b.quaternion.w))), 0);
		z.updateViewmodel(0, true, 0.829, 0, restVmFeel(), 0);
		const held = { bend: bend(), z: pair.hands.l.group.position.z };
		z.updateViewmodel(0, true, 0.86, 0, restVmFeel(), 0);
		expect(bend()).toBeLessThan(held.bend * 0.8);
		expect(pair.hands.l.group.position.z).toBeGreaterThan(held.z - 0.2);
		z.dispose();
	});

	it('the hand stays on the magazine it carries', async () => {
		for (const id of GUNS) {
			const z = await gun(id);
			const c = FP_RELOADS[id].empty;
			const pair = z.hands(id)!;
			for (const t of id === 'pistol' ? [c.times!.fresh + 0.02, 0.5] : [c.times!.out + 0.02, c.times!.stow - 0.02, c.times!.fresh + 0.02, c.times!.seat - 0.01]) {
				z.updateViewmodel(0, true, t, 0, restVmFeel(), 0);
				const p = pair.pose('mag')!;
				expect(pair.hands.l.group.position.distanceTo(new THREE.Vector3(...p.p)), id + ' ' + t).toBeLessThan(1e-6);
			}
			z.dispose();
		}
	});
});

describe('cancel', () => {
	it.each(GUNS)('%s: cut short, it is back at rest within 150 ms and nothing jumps on the way', async (id) => {
		expect(CANCEL_MS).toBeLessThanOrEqual(150);
		const z = await gun(id);
		const ms = WEAPONS[id].reloadMs;
		const t = FP_RELOADS[id].empty.times!;
		let now = 1000;
		for (const at of [0.06, t.out + 0.03, (t.stow + t.fresh) / 2, t.seat - 0.04, 0.8, 0.9]) {
			z.updateViewmodel((now += 5000), true, 1, 0, restVmFeel(), 3);
			const rest = state(z, id);
			for (let p = 0; p <= at; p += 0.02) z.updateViewmodel(now + p * ms, true, p, 0, restVmFeel(), 3);
			now += at * ms;
			const cut = state(z, id);
			// The frame it is cancelled in shows what was there.
			z.updateViewmodel(now, true, 1, 0, restVmFeel(), 3);
			const first = state(z, id);
			for (const n of ['x', 'y', 'z'] as const) expect(Math.abs(first.parts.mag!.p[n] - cut.parts.mag!.p[n]), id + ' ' + at).toBeLessThan(1e-6);
			cut.gun.forEach((v, i) => expect(first.gun[i]).toBeCloseTo(v, 6));
			if (cut.l.on && rest.l.on) expect(first.l.p.distanceTo(cut.l.p), id + ' ' + at).toBeLessThan(1e-4);
			let prev = first;
			for (let d = 4; d <= CANCEL_MS; d += 4) {
				z.updateViewmodel(now + d, true, 1, 0, restVmFeel(), 3);
				const s = state(z, id);
				expect(s.parts.mag!.on).toBe(true);
				expect(Math.hypot(...[0, 1, 2].map((k) => s.gun[k]! - prev.gun[k]!))).toBeLessThan(0.15);
				prev = s;
			}
			z.updateViewmodel(now + 150, true, 1, 0, restVmFeel(), 3);
			same(state(z, id), rest, id + ' ' + at);
		}
		z.dispose();
	});

	it('a swap, death or spectating leaves no part behind: the next weapon and the gun taken up again are at rest', async () => {
		const z = await gun('lmg');
		await z.preload(['pistol']);
		const rest = state(z, 'lmg');
		z.updateViewmodel(100, true, 0.5, 0, restVmFeel(), 0);
		// Death and spectating hide the viewmodel at once.
		z.updateViewmodel(110, false, 0.5, 0, restVmFeel(), 0);
		expect(z.vmVisible).toBe(false);
		z.setWeapon('pistol');
		z.updateViewmodel(120, true, 1, 0, restVmFeel(), 12);
		expect([...z.anim.gun]).toEqual([0, 0, 0, 0, 0, 0]);
		z.setWeapon('lmg');
		z.updateViewmodel(130, true, 1, 0, restVmFeel(), 100);
		same(state(z, 'lmg'), rest, 'lmg');
		z.dispose();
	});

	it('a swap with a draw: the gun goes down as it was, is out of the picture within 150 ms, and is at rest again', async () => {
		const z = await gun('smg');
		await z.preload(['pistol']);
		const rest = state(z, 'smg');
		z.updateViewmodel(1000, true, 0.3, 0, restVmFeel(), 0);
		const group = z.rig('smg')!.part('mag')!;
		const cut = group.position.clone();
		z.setWeapon('pistol');
		const drawn = (o: THREE.Object3D) => {
			let on = false;
			z.vmScene.traverseVisible((c) => (on ||= c === o));
			return on;
		};
		let last = 0;
		let y = Infinity;
		for (let t = 1005; t <= 1160; t += 5) {
			z.updateViewmodel(t, true, 1, 0, { ...restVmFeel(), lower: 0.9 }, 12);
			if (!drawn(group)) continue;
			last = t;
			expect(group.position.distanceTo(cut)).toBeLessThan(1e-9);
			z.vmScene.updateMatrixWorld(true);
			const now = group.getWorldPosition(new THREE.Vector3()).y;
			expect(now).toBeLessThanOrEqual(y + 1e-9);
			y = now;
		}
		expect(last).toBeGreaterThan(1050);
		expect(last - 1005).toBeLessThanOrEqual(150);
		// Taken up again it is whole.
		z.setWeapon('smg');
		z.updateViewmodel(2000, true, 1, 0, restVmFeel(), 36);
		z.updateViewmodel(2001, true, 1, 0, restVmFeel(), 36);
		same(state(z, 'smg'), rest, 'smg');
		// A weapon put in the hands without a draw (a spawn, claws) takes its place at once.
		z.setWeapon('pistol');
		z.updateViewmodel(3000, true, 1, 0, restVmFeel(), 12);
		expect(drawn(group)).toBe(false);
		z.dispose();
	});

	it('a reload started while the bolt is open takes over from where it is', async () => {
		const z = await gun('sniper');
		z.fired(1000);
		for (let t = 1000; t <= 1450; t += 10) z.updateViewmodel(t, true, 1, 0, restVmFeel(), 0);
		const bolt = z.rig('sniper')!.part('bolt')!;
		const before = bolt.position.clone();
		z.updateViewmodel(1450, true, 0, 0, restVmFeel(), 0);
		expect(bolt.position.distanceTo(before)).toBeLessThan(1e-6);
		z.dispose();
	});
});

describe('shots', () => {
	it('the slide and the bolts go back and return; the trigger moves and the finger with it', async () => {
		for (const id of GUNS) {
			if (id === 'sniper') continue;
			const z = await gun(id);
			const rig = z.rig(id)!;
			const part = rig.part(rig.part('slide') ? 'slide' : 'bolt')!;
			const rest = part.position.clone();
			const trigger = rig.part('trigger')!.quaternion.clone();
			const finger = z.hands(id)!.hands.r.mesh.skeleton.bones.find((b) => b.name === 'index2')!;
			const straight = finger.quaternion.clone();
			z.fired(1000);
			z.updateViewmodel(1000 + CYCLES[id]!.ms * 0.35, true, 1, 0, restVmFeel(), 5);
			expect(part.position.distanceTo(rest) * rig.len, id).toBeGreaterThan(2);
			z.updateViewmodel(1030, true, 1, 0, restVmFeel(), 5);
			expect(rig.part('trigger')!.quaternion.angleTo(trigger), id).toBeGreaterThan(0.2);
			expect(finger.quaternion.angleTo(straight), id).toBeGreaterThan(0.03);
			z.updateViewmodel(1400, true, 1, 0, restVmFeel(), 5);
			expect(part.position.distanceTo(rest), id).toBeLessThan(1e-9);
			expect(finger.quaternion.angleTo(straight), id).toBeLessThan(1e-6);
			z.dispose();
		}
	});

	it('the pistol locks back on its last round, and is still open when it is taken up again', async () => {
		const z = await gun('pistol');
		const slide = z.rig('pistol')!.part('slide')!;
		const rest = slide.position.clone();
		z.fired(1000);
		for (const t of [1060, 1200, 9000]) {
			z.updateViewmodel(t, true, 1, 0, restVmFeel(), 0);
			expect(slide.position.distanceTo(rest) * z.rig('pistol')!.len, String(t)).toBeGreaterThan(2);
		}
		z.setWeapon('knife');
		z.setWeapon('pistol');
		z.updateViewmodel(9100, true, 1, 0, restVmFeel(), 0);
		expect(slide.position.distanceTo(rest)).toBeGreaterThan(0.1);
		z.updateViewmodel(9200, true, 1, 0, restVmFeel(), 12);
		expect(slide.position.distanceTo(rest)).toBeLessThan(1e-9);
		z.dispose();
	});

	it('the belt of the LMG runs short and is back with a new box', async () => {
		const z = await gun('lmg');
		const belt = z.rig('lmg')!.part('belt')!;
		let drawn = 0;
		belt.traverse((o) => {
			if (o instanceof THREE.Mesh) drawn = (o.geometry as THREE.BufferGeometry).drawRange.count;
		});
		const count = (mag: number, reload = 1) => {
			z.updateViewmodel(5000, true, reload, 0, restVmFeel(), mag);
			let n = 0;
			belt.traverse((o) => {
				if (o instanceof THREE.Mesh) n = Math.min((o.geometry as THREE.BufferGeometry).drawRange.count, (o.geometry as THREE.BufferGeometry).index!.count);
			});
			return belt.visible ? n : 0;
		};
		expect(drawn).toBeGreaterThan(0);
		const all = count(100);
		const seen = [8, 6, 4, 2, 1, 0].map((m) => count(m));
		expect(seen[0]).toBe(all);
		expect(seen.at(-1)).toBe(0);
		for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeLessThan(seen[i - 1]!);
		// A third of the triangles for a third of the rounds, roughly.
		expect(Math.abs(count(4) / all - 4 / BELT_ROUNDS)).toBeLessThan(0.15);
		expect(count(0, 0.6)).toBe(all);
		z.dispose();
	});

	it('the belt of the LMG goes on by one round per shot along its way, out of the box and into the feed, and is where it was', async () => {
		const z = await gun('lmg');
		const belt = z.rig('lmg')!.part('belt')!;
		let mesh: THREE.Mesh | undefined;
		belt.traverse((o) => {
			if (o instanceof THREE.Mesh) mesh = o;
		});
		const pos = () => Float32Array.from((mesh!.geometry as THREE.BufferGeometry).getAttribute('position').array);
		z.updateViewmodel(500, true, 1, 0, restVmFeel(), 50);
		const rest = pos();
		const at = (ms: number) => {
			z.fired(1000 + ms * 100);
			z.updateViewmodel(1000 + ms * 100 + ms, true, 1, 0, restVmFeel(), 49);
			return pos();
		};
		const first = at(0);
		// A whole round moved together, towards the next one's place: up out of the box, over the edge, in to the right.
		const len = z.rig('lmg')!.len;
		let furthest = 0;
		let up = 0;
		let right = 0;
		for (let i = 0; i < rest.length; i += 3) {
			const d = [0, 1, 2].map((k) => (rest[i + k]! - first[i + k]!) * len);
			furthest = Math.max(furthest, Math.hypot(...d));
			// Never along the bore.
			expect(Math.abs(d[2]!)).toBeLessThan(1e-3);
			if (d[1]! > 0.5) up++;
			if (d[0]! > 0.5) right++;
		}
		// One pitch, as far as the rounds are apart.
		expect(furthest).toBeGreaterThan(0.6);
		expect(furthest).toBeLessThan(1);
		expect(up).toBeGreaterThan(50);
		expect(right).toBeGreaterThan(50);
		// Half-way, and all the way.
		const moved = (p: Float32Array) => Math.max(...Array.from(p, (v, i) => Math.abs(v - rest[i]!)));
		expect(moved(at(BELT_MS / 2))).toBeGreaterThan(moved(first) * 0.3);
		expect(moved(at(BELT_MS / 2))).toBeLessThan(moved(first) * 0.7);
		expect(moved(at(BELT_MS))).toBe(0);
		expect(BELT_MS).toBeLessThan(WEAPONS.lmg.fireMs);
		// Put away in the middle of it, it is at rest again.
		expect(moved(at(10))).toBeGreaterThan(0);
		z.setWeapon('pistol');
		z.setWeapon('lmg');
		expect(moved(pos())).toBe(0);
		z.dispose();
	});

	it('the sniper works its bolt with the right hand after a shot, and the case is out when it opens', async () => {
		const z = await gun('sniper');
		const bolt = z.rig('sniper')!.part('bolt')!;
		const rest = { p: bolt.position.clone(), q: bolt.quaternion.clone() };
		z.fired(1000);
		let opened = 0;
		let back = 0;
		for (let t = 1000; t < 2000; t += 8) {
			z.updateViewmodel(t, true, 1, 0, restVmFeel(), 3);
			if (z.anim.events.opened) opened++;
			back = Math.max(back, bolt.position.distanceTo(rest.p) * z.rig('sniper')!.len);
		}
		expect(opened).toBe(1);
		expect(back).toBeGreaterThan(4);
		expect(bolt.position.distanceTo(rest.p)).toBeLessThan(1e-9);
		// Behind the scope too, where the gun isn't drawn.
		z.fired(5000);
		opened = 0;
		for (let t = 5000; t < 6000; t += 8) {
			z.updateViewmodel(t, false, 1, 0, { ...restVmFeel(), aim: 1 }, 2);
			if (z.anim.events.opened) opened++;
		}
		expect(opened).toBe(1);
		z.dispose();
	});

	it('an empty chamber looks dry: only the trigger moves', async () => {
		for (const id of GUNS) {
			const z = await gun(id);
			const rig = z.rig(id)!;
			z.updateViewmodel(1000, true, 1, 0, restVmFeel(), 0);
			const before = state(z, id);
			z.updateViewmodel(1040, true, 1, 0, { ...restVmFeel(), dry: 1 }, 0);
			const s = state(z, id);
			expect(s.parts.trigger!.q.angleTo(before.parts.trigger!.q), id).toBeGreaterThan(0.2);
			for (const n of rig.names) if (n !== 'trigger') expect(s.parts[n]!.p.distanceTo(before.parts[n]!.p), id + ' ' + n).toBeLessThan(1e-9);
			expect(z.casings.stats.live).toBe(0);
			z.dispose();
		}
	});
});

describe('without a loaded model', () => {
	it('a code-built gun only moves as a whole, at rest at both ends', () => {
		for (const id of GUNS) {
			const z = new ZombieRenderer(new HeldAssets(), noLoad);
			z.setWeapon(id);
			z.fired(0);
			for (let i = 0; i <= 50; i++) z.updateViewmodel(i * 30, true, i / 50, 0, undefined, 0);
			z.updateViewmodel(5000, true, 1, 0);
			expect([...z.anim.gun], id).toEqual([0, 0, 0, 0, 0, 0]);
			z.dispose();
		}
	});
});
