/**
 * Infected HUD feedback derived from the server's events (docs/modes.md#infected):
 * score popups, where a hit came from, and the round summary rows. Pure helpers
 * plus one small state holder that InfectedClient hands every event.
 *
 * Server rules this mirrors (packages/shared/src/modes/infected/game.ts):
 * - Score is paid for a kill, an infection (more for a thrown knife and a bank
 *   shot), a smashed beacon, the specialist perk and a M.O.A.B. to whoever did
 *   it. Every other living survivor is paid when a survivor is infected, and
 *   every living survivor when the survivors win (clock or M.O.A.B.).
 * - A survivor who takes over for infected who all left is announced with an
 *   `infect` that adds no time: nobody is paid for that one.
 * - `shot` goes to everyone but the shooter and comes before the `hit`,
 *   `hurt`, `kill` and `infect` it caused, so it gives the direction of a
 *   hit whose own event carries none.
 * - A knife in flight sends no `shot`: the `infect` of a thrown knife or a
 *   bank shot carries the direction it travelled itself (`dx`, `dy`).
 */
import {
	INF_SCORE_BANK_BONUS,
	INF_SCORE_BEACON_DESTROY,
	INF_SCORE_INFECT,
	INF_SCORE_KILL,
	INF_SCORE_KNIFE_BONUS,
	INF_SCORE_MOAB,
	INF_SCORE_SPECIALIST,
	INF_SCORE_SURVIVE_TICK,
	INF_SCORE_SURVIVE_WIN,
	isWeaponId,
	WEAPONS,
	type InfEvent,
	type InfPlayerView,
	type InfRoundStat,
	type InfTeam
} from '@surf/shared';

/** A score popup lives this long (the HUD fades it out at the end). */
export const INF_POP_MS = 2400;
/** Popups kept at once; a newer one pushes the oldest out. Three rows stay clear of the respawn panel under the crosshair. */
export const INF_POP_MAX = 3;
/** A hit direction arc lives this long; the killing blow longer. */
export const INF_HURT_MS = 1200;
export const INF_HURT_LETHAL_MS = 2200;
/** Arcs kept at once. */
export const INF_HURT_MAX = 4;
/** Arcs turn with the view in steps of this many degrees (the HUD view is rebuilt per step). */
export const INF_HURT_STEP_DEG = 2;
/** A `shot` explains a hit that arrives within this time (same server flush). */
const SHOT_PAIR_MS = 150;

/** Whose feedback the HUD shows: the local player or the spectate target. */
export interface InfViewer {
	id: number;
	team: InfTeam;
	alive: boolean;
}

export interface InfAward {
	points: number;
	label: string;
}

/** One score popup ("+100 Kill"). */
export interface InfScorePop extends InfAward {
	id: number;
	at: number;
}

/** A hit on the local player, aimed for the current view. */
export interface InfHurtDir {
	id: number;
	at: number;
	/** Where it came from: degrees clockwise from straight ahead (-180..180, 0 = in front, 90 = right). */
	bearing: number;
	/** The hit that killed or infected me. */
	lethal: boolean;
}

/** One player of the round summary table. */
export interface InfSummaryRow {
	id: number;
	name: string;
	/** Team when the round ended. */
	team: InfTeam;
	/** Was Patient Zero this round. */
	alpha: boolean;
	score: number;
	kills: number;
	infections: number;
	deaths: number;
	/** Hits per trigger pull in percent (0..100), null without a shot. */
	accuracy: number | null;
	bestStreak: number;
}

const NO_AWARDS: readonly InfAward[] = Object.freeze([]);
const NO_POPS: readonly InfScorePop[] = Object.freeze([]);
const NO_HURTS: readonly InfHurtDir[] = Object.freeze([]);
const NO_PLAYERS: readonly InfPlayerView[] = Object.freeze([]);
const hurtLife = (lethal: boolean): number => (lethal ? INF_HURT_LETHAL_MS : INF_HURT_MS);

/**
 * Score `viewer` earned with `ev`, as the server pays it. `viewer` is the
 * player as they were before the event (an `infect` of the viewer pays nothing).
 */
export function infScoreAwards(ev: InfEvent, viewer: InfViewer): readonly InfAward[] {
	const survivor = viewer.team === 'survivor' && viewer.alive;
	switch (ev.e) {
		case 'kill':
			return ev.by === viewer.id ? [{ points: INF_SCORE_KILL, label: ev.head ? 'Headshot' : 'Kill' }] : NO_AWARDS;
		case 'infect':
			if (ev.by === viewer.id) {
				if (ev.method === 'bank') return [{ points: INF_SCORE_INFECT + INF_SCORE_KNIFE_BONUS + INF_SCORE_BANK_BONUS, label: 'Bank shot' }];
				if (ev.method === 'knife') return [{ points: INF_SCORE_INFECT + INF_SCORE_KNIFE_BONUS, label: 'Thrown knife' }];
				return [{ points: INF_SCORE_INFECT, label: 'Infection' }];
			}
			// A takeover for infected who left adds no time and pays nobody.
			return survivor && ev.id !== viewer.id && ev.timeAdded > 0 ? [{ points: INF_SCORE_SURVIVE_TICK, label: 'Survived' }] : NO_AWARDS;
		case 'beaconDestroy':
			return ev.by === viewer.id ? [{ points: INF_SCORE_BEACON_DESTROY, label: 'Beacon' }] : NO_AWARDS;
		case 'perk':
			return ev.id === viewer.id && ev.perk === 'specialist' ? [{ points: INF_SCORE_SPECIALIST, label: 'Specialist' }] : NO_AWARDS;
		case 'moabDetonate':
			return ev.by === viewer.id ? [{ points: INF_SCORE_MOAB, label: 'M.O.A.B.' }] : NO_AWARDS;
		case 'end':
			return survivor && ev.winner === 'survivors' ? [{ points: INF_SCORE_SURVIVE_WIN, label: 'Round won' }] : NO_AWARDS;
		default:
			return NO_AWARDS;
	}
}

/** World yaw (degrees) a hit came from, given the horizontal direction it travelled; null without one. */
export function hitSourceYaw(dx: number, dy: number): number | null {
	if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1e-6) return null;
	return (Math.atan2(-dy, -dx) * 180) / Math.PI;
}

/**
 * Source yaw of a `hurt`: the server's hit direction, else the knockback
 * (same direction, zero for weapons without knockback), else `shotYaw` (the
 * shot that came just before it).
 */
export function hurtSourceYaw(ev: Extract<InfEvent, { e: 'hurt' }>, shotYaw: number | null = null): number | null {
	return (ev.dx !== undefined && ev.dy !== undefined ? hitSourceYaw(ev.dx, ev.dy) : null) ?? hitSourceYaw(ev.kx, ev.ky) ?? shotYaw;
}

/**
 * Source yaw of an `infect`: the direction the knife travelled when the event
 * carries one (thrown knife, bank shot), else `shotYaw` (the claw swing that
 * came just before it).
 */
export function infectSourceYaw(ev: Extract<InfEvent, { e: 'infect' }>, shotYaw: number | null = null): number | null {
	return (ev.dx !== undefined && ev.dy !== undefined ? hitSourceYaw(ev.dx, ev.dy) : null) ?? shotYaw;
}

/**
 * Where world yaw `sourceYaw` lies for a player looking along `viewYaw`:
 * degrees clockwise from straight ahead in (-180, 180]. Source yaw grows
 * counter-clockwise, so a source on the left is negative.
 */
export function hitBearing(viewYaw: number, sourceYaw: number): number {
	const b = (((viewYaw - sourceYaw) % 360) + 360) % 360;
	return b > 180 ? b - 360 : b;
}

/** `bearing` rounded to INF_HURT_STEP_DEG, in (-180, 180]. */
function stepBearing(bearing: number): number {
	const b = Math.round(bearing / INF_HURT_STEP_DEG) * INF_HURT_STEP_DEG;
	// + 0: no negative zero.
	return (b <= -180 ? b + 360 : b) + 0;
}

/** Summary rows from the `end` stats, best score first (then kills and infections, then name). */
export function infSummaryRows(stats: readonly InfRoundStat[], name: (id: number) => string): InfSummaryRow[] {
	const rows = stats.map((s) => ({
		id: s.id,
		name: name(s.id),
		team: s.team,
		alpha: s.alpha,
		score: s.score,
		kills: s.kills,
		infections: s.infections,
		deaths: s.deaths,
		accuracy: s.shots > 0 ? Math.round(Math.max(0, Math.min(1, s.hits / s.shots)) * 100) : null,
		bestStreak: s.bestStreak
	}));
	return rows.sort((a, b) => b.score - a.score || b.kills + b.infections - (a.kills + a.infections) || a.name.localeCompare(b.name));
}

/** What InfFeedback reads from its InfectedClient. */
export interface InfFeedbackHost {
	/** Local player id, team and alive flag (as predicted by the client). */
	me(): number;
	team(): InfTeam;
	alive(): boolean;
	/** Spectating (free-fly or a target): no hit arcs, popups of the target only. */
	spectating(): boolean;
	/** Spectate target, null in free-fly. */
	specId(): number | null;
	/** Players of the latest mode state. */
	players(): readonly InfPlayerView[] | undefined;
	name(id: number): string;
}

interface Hurt {
	id: number;
	at: number;
	/** World yaw the hit came from. */
	yaw: number;
	lethal: boolean;
}
const NO_LIVE: readonly Hurt[] = Object.freeze([]);

/**
 * Feedback state of one InfectedClient. `event` takes every server event
 * (before the client applies it), `frame` ages it once per rendered frame.
 * The outputs are replaced, never mutated, and only when they change.
 */
export class InfFeedback {
	/** Score popups of the viewer, oldest first. */
	scorePops: readonly InfScorePop[] = NO_POPS;
	/** Hits on me, aimed for the last `frame` view yaw. */
	hurtDirs: readonly InfHurtDir[] = NO_HURTS;
	/** Rows of the last `end` event, null when the server sent no stats. */
	summaryRows: InfSummaryRow[] | null = null;
	/** Label of the next round's survivor primary, null when the server did not say. */
	nextLoadoutLabel: string | null = null;

	private rev = 0;
	private popId = 0;
	/** Player the popups belong to (a new viewer starts empty). */
	private popFor: number | null = null;
	private hurts: Hurt[] = [];
	private hurtId = 0;
	/** Last shot seen: shooter, source yaw and time. */
	private shotBy = -1;
	private shotYaw: number | null = null;
	private shotAt = -Infinity;
	/** Players turned this round by an event (the mode state can lag behind). */
	private turned = new Set<number>();
	/** Scratch viewer (no allocation per event or frame). */
	private readonly v: InfViewer = { id: 0, team: 'survivor', alive: false };

	constructor(private readonly host: InfFeedbackHost) {}

	event(ev: InfEvent, now: number): void {
		const me = this.host.me();
		switch (ev.e) {
			case 'phase':
				if (ev.phase === 'grace' || ev.phase === 'waiting') this.reset();
				return;
			case 'shot':
				this.shotBy = ev.by;
				this.shotYaw = hitSourceYaw(ev.d.x, ev.d.y);
				this.shotAt = now;
				return;
			case 'hurt':
				if (ev.id === me) this.hurt(now, hurtSourceYaw(ev, this.shotYawNear(now, null)), false);
				return;
			case 'kill':
				if (ev.targetId === me) this.hurt(now, this.shotYawNear(now, ev.by), true);
				break;
			case 'infect':
				if (ev.id === me && ev.by !== null) this.hurt(now, infectSourceYaw(ev, this.shotYawNear(now, ev.by)), true);
				break;
			case 'end':
				this.summaryRows = ev.stats ? infSummaryRows(ev.stats, (id) => this.host.name(id)) : null;
				this.nextLoadoutLabel = ev.nextLoadout !== undefined && isWeaponId(ev.nextLoadout) ? WEAPONS[ev.nextLoadout].label : null;
				this.rev++;
				break;
			case 'alpha':
			case 'beaconDestroy':
			case 'perk':
			case 'moabDetonate':
				break;
			default:
				return;
		}
		if (this.viewer()) for (const a of infScoreAwards(ev, this.v)) this.pop(this.v.id, a, now);
		if (ev.e === 'alpha' || ev.e === 'infect') this.turned.add(ev.id);
	}

	/**
	 * Fill `this.v` with whose score popups show: me, or the spectate target
	 * from the mode state. False in free-fly and for an unknown target.
	 */
	private viewer(): boolean {
		const h = this.host;
		const v = this.v;
		const me = h.me();
		if (!h.spectating()) {
			v.id = me;
			v.team = h.team();
			v.alive = h.alive();
		} else {
			const id = h.specId();
			let p: InfPlayerView | undefined;
			if (id !== null && id !== me) for (const q of h.players() ?? NO_PLAYERS) if (q.id === id) p = q;
			if (!p) return false;
			v.id = p.id;
			v.team = p.team;
			v.alive = p.alive;
		}
		if (this.turned.has(v.id)) v.team = 'infected';
		return true;
	}

	/**
	 * Once per frame: drop expired popups and arcs, drop popups of another
	 * viewer, aim the arcs for `viewYaw`. Returns a number that changes
	 * whenever an output changed (the client's view key).
	 */
	frame(now: number, viewYaw: number): number {
		const pops = this.scorePops;
		if (pops.length > 0) {
			if (!this.viewer() || this.v.id !== this.popFor) this.setPops(NO_POPS);
			else if (now - pops[0]!.at >= INF_POP_MS) this.setPops(pops.filter((p) => now - p.at < INF_POP_MS));
		}
		if (this.hurts.length > 0 || this.hurtDirs.length > 0) this.aim(now, viewYaw);
		return this.rev;
	}

	private setPops(pops: readonly InfScorePop[]): void {
		this.scorePops = pops.length > 0 ? pops : NO_POPS;
		this.rev++;
	}

	private pop(viewerId: number, a: InfAward, now: number): void {
		const keep = this.popFor === viewerId ? this.scorePops.slice(-(INF_POP_MAX - 1)) : [];
		this.popFor = viewerId;
		this.setPops([...keep, { id: ++this.popId, points: a.points, label: a.label, at: now }]);
	}

	/** Source yaw of the latest shot when it is recent (and by `by`, unless null). */
	private shotYawNear(now: number, by: number | null): number | null {
		if (now - this.shotAt > SHOT_PAIR_MS || (by !== null && by !== this.shotBy)) return null;
		return this.shotYaw;
	}

	private hurt(now: number, yaw: number | null, lethal: boolean): void {
		if (yaw === null) return;
		if (this.hurts.length >= INF_HURT_MAX) this.hurts.shift();
		this.hurts.push({ id: ++this.hurtId, at: now, yaw, lethal });
	}

	/** Rebuild `hurtDirs` when an arc came, went or turned a step. */
	private aim(now: number, viewYaw: number): void {
		let expired = false;
		for (const h of this.hurts) if (now - h.at >= hurtLife(h.lethal)) expired = true;
		if (expired) this.hurts = this.hurts.filter((h) => now - h.at < hurtLife(h.lethal));
		const live = this.host.spectating() ? NO_LIVE : this.hurts;
		const prev = this.hurtDirs;
		let same = live.length === prev.length;
		for (let i = 0; same && i < live.length; i++) {
			same = live[i]!.id === prev[i]!.id && stepBearing(hitBearing(viewYaw, live[i]!.yaw)) === prev[i]!.bearing;
		}
		if (same) return;
		this.hurtDirs = live.length > 0 ? live.map((h) => ({ id: h.id, at: h.at, bearing: stepBearing(hitBearing(viewYaw, h.yaw)), lethal: h.lethal })) : NO_HURTS;
		this.rev++;
	}

	/** A new round: nothing carries over. */
	private reset(): void {
		if (this.scorePops.length > 0) this.setPops(NO_POPS);
		this.popFor = null;
		this.hurts = [];
		if (this.hurtDirs.length > 0) {
			this.hurtDirs = NO_HURTS;
			this.rev++;
		}
		this.turned.clear();
		this.shotAt = -Infinity;
		if (this.summaryRows || this.nextLoadoutLabel) {
			this.summaryRows = null;
			this.nextLoadoutLabel = null;
			this.rev++;
		}
	}
}
