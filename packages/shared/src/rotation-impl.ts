/**
 * Map rotation and voting (docs/gameplay.md#map-rotation-and-voting).
 * Contract in ./rotation.ts. All times are ms timestamps supplied by the
 * caller, so the class is deterministic given `now` and `rng`.
 */
import type { VoteOption } from './protocol.ts';
import type { ActiveVote, RotationEvent, RtvRequestEndReason, RtvRequestState } from './rotation.ts';
import {
	CHANGE_COUNTDOWN,
	MAX_VOTE_MAPS,
	RTV_DECLINE_COOLDOWN,
	RTV_REQUEST_DURATION,
	EXTEND_DURATION,
	MAP_DURATION,
	MAX_EXTENDS,
	RTV_BLOCK,
	RTV_RATIO,
	VOTE_AT,
	VOTE_DURATION,
	VOTE_MAP_SLOTS
} from './rotation.ts';

export class MapRotation {
	vote: ActiveVote | null = null;
	/** Open RTV request (yes/no on starting a map vote), or null. */
	request: RtvRequestState | null = null;
	private _current: string;
	private readonly maps: string[];
	/** Maps that may come up in votes and random picks (docs/gameplay.md#admin); all when unset. */
	private readonly isEnabled: (mapId: string) => boolean;
	/** Map category (kind) for VOTE_MAP_SLOTS. */
	private readonly kindOf: (mapId: string) => string;
	private readonly rng: () => number;
	private mapStartedAt: number;
	private endsAt: number;
	private extends = 0;
	/** The scheduled (time-left) vote already ran for the current end time. */
	private scheduledVoteDone = false;
	private readonly ballots = new Map<string, number>(); // voterId -> 0-based option
	/** No new RTV request before this ms timestamp (set when one is declined). */
	private declinedUntil = -Infinity;
	private requestDirty = false;
	private pending: { map: string; at: number } | null = null;
	private countsDirty = false;
	/** Seconds per map and RTV lockout (defaults MAP_DURATION / RTV_BLOCK; shorter for dev testing). */
	private readonly duration: number;
	private readonly rtvBlock: number;

	constructor(opts: {
		maps: string[];
		current: string;
		now: number;
		rng?: () => number;
		mapDuration?: number;
		rtvBlock?: number;
		/**
		 * Live filter for vote options, `!rtv` and random picks (admin-disabled
		 * maps return false). Checked on every pick, so changes apply at once.
		 * `forceMap` ignores it.
		 */
		isEnabled?: (mapId: string) => boolean;
		/** Map category (map kind: surf, bhop, tag, zombies) for the per-category vote slots. */
		kindOf?: (mapId: string) => string;
	}) {
		this.kindOf = opts.kindOf ?? (() => '');
		this.maps = [...opts.maps];
		this.isEnabled = opts.isEnabled ?? (() => true);
		this._current = opts.current;
		this.rng = opts.rng ?? Math.random;
		this.duration = opts.mapDuration ?? MAP_DURATION;
		this.rtvBlock = opts.rtvBlock ?? RTV_BLOCK;
		this.mapStartedAt = opts.now;
		this.endsAt = opts.now + this.duration * 1000;
	}

	get current(): string {
		return this._current;
	}

	/** Extends used on the current map. */
	get extendCount(): number {
		return this.extends;
	}

	/** Map chosen by the last vote, waiting for the countdown (null if none). */
	get nextMap(): string | null {
		return this.pending?.map ?? null;
	}

	timeLeft(now: number): number {
		return Math.max(0, (this.endsAt - now) / 1000);
	}

	/** ceil(voters / 3), minimum 1 (1–3 players: 1, 4–6: 2, 7–9: 3, …). */
	static rtvNeeded(voters: number): number {
		return Math.max(1, Math.ceil(Math.max(0, voters) * RTV_RATIO - 1e-9));
	}

	update(now: number, voters: number): RotationEvent[] {
		const ev: RotationEvent[] = [];

		if (this.pending) {
			if (now >= this.pending.at) ev.push(this.changeMap(this.pending.map, now));
			return ev;
		}

		if (this.vote) {
			if (now >= this.vote.endsAt) ev.push(...this.resolve(now));
			else if (this.countsDirty) {
				this.countsDirty = false;
				ev.push({ type: 'voteUpdate', counts: this.vote.counts.slice() });
			}
			return ev;
		}

		if (this.request) {
			// Timeout, or players left/joined: the threshold may have changed.
			if (now >= this.request.endsAt) ev.push(this.endRequest(false, 'timeout', now));
			else ev.push(...this.checkRequest(voters, now));
			if (this.vote || this.pending) return ev;
		}

		const left = this.timeLeft(now);
		if (!this.scheduledVoteDone && left <= VOTE_AT) {
			this.scheduledVoteDone = true;
			if (this.request) ev.push(this.endRequest(false, 'cancelled', now));
			ev.push(...this.openVote(now, false));
		} else if (left <= 0) {
			// Safety net: time ran out without a pending change.
			ev.push(this.changeMap(this.randomOther() ?? this._current, now));
		}
		return ev;
	}

	castVote(voterId: string, option: number, now: number): RotationEvent[] {
		const v = this.vote;
		if (!v || now >= v.endsAt) return [];
		if (!Number.isInteger(option) || option < 1 || option > v.options.length) return [];
		const idx = option - 1;
		if (this.ballots.get(voterId) === idx) return [];
		this.ballots.set(voterId, idx);
		this.recount();
		this.countsDirty = false;
		return [{ type: 'voteUpdate', counts: v.counts.slice() }];
	}

	/** `!rtv`: an RTV request without a nominated map (or a yes vote on the open one). */
	rtv(voterId: string, voters: number, now: number): RotationEvent[] | { error: string } {
		return this.requestRtv(voterId, voters, now, null);
	}

	/**
	 * Start an RTV request: the initiator votes yes and `mapId` (optional) is
	 * nominated, i.e. guaranteed a slot in the vote if the request passes.
	 * With a request already open, counts as a yes vote on it (without a
	 * nomination). Passes at once when the initiator alone is enough.
	 */
	requestRtv(voterId: string, voters: number, now: number, mapId: string | null = null): RotationEvent[] | { error: string } {
		if (this.vote) return { error: 'A vote is already in progress.' };
		if (this.pending) return { error: 'The map is about to change.' };
		if (this.request) {
			if (mapId !== null) return { error: 'A map vote request is already open: press 1 to agree.' };
			if (this.request.yes.has(voterId)) return { error: 'You already agreed to the map vote request.' };
			return this.rtvVote(voterId, true, voters, now);
		}
		const wait = this.rtvAvailableIn(now);
		if (wait) {
			return {
				error:
					wait.reason === 'declined'
						? `Map vote declined — try again in ${wait.seconds} s.`
						: `Rock the vote is available in ${wait.seconds} s.`
			};
		}
		if (mapId !== null) {
			if (!this.maps.includes(mapId)) return { error: `Unknown map "${mapId.slice(0, 64)}".` };
			if (mapId === this._current) return { error: 'That map is already being played.' };
			if (!this.isEnabled(mapId)) return { error: 'That map is disabled by an admin.' };
		}
		if (this.optionsFor(true).length === 0) return { error: 'There are no other maps.' };
		this.request = {
			initiator: voterId,
			mapId,
			endsAt: now + RTV_REQUEST_DURATION * 1000,
			yes: new Set([voterId]),
			no: new Set(),
			needed: MapRotation.rtvNeeded(voters)
		};
		this.requestDirty = false;
		const ev: RotationEvent[] = [this.requestEvent(true, now)];
		ev.push(...this.checkRequest(voters, now));
		return ev;
	}

	/** Yes/no on the open RTV request; changing your answer is allowed. */
	rtvVote(voterId: string, yes: boolean, voters: number, now: number): RotationEvent[] | { error: string } {
		const r = this.request;
		if (!r || now >= r.endsAt) return { error: 'No map vote request is open.' };
		if ((yes ? r.yes : r.no).has(voterId)) return [];
		(yes ? r.no : r.yes).delete(voterId);
		(yes ? r.yes : r.no).add(voterId);
		this.requestDirty = true;
		return this.checkRequest(voters, now);
	}

	/** Seconds until an RTV request may start (decline cooldown or map-start block), or null if now. */
	rtvAvailableIn(now: number): { seconds: number; reason: 'declined' | 'mapStart' } | null {
		const block = this.mapStartedAt + this.rtvBlock * 1000;
		const until = Math.max(block, this.declinedUntil);
		if (now >= until) return null;
		return { seconds: Math.ceil((until - now) / 1000), reason: until === block ? 'mapStart' : 'declined' };
	}

	removeVoter(voterId: string): void {
		if (this.request && (this.request.yes.delete(voterId) || this.request.no.delete(voterId))) {
			this.requestDirty = true;
		}
		if (this.ballots.delete(voterId) && this.vote) {
			this.recount();
			this.countsDirty = true;
		}
	}

	/**
	 * Switch to `map` at once, as if a vote had picked it: cancels any vote,
	 * rtv or pending change, resets extends and the map timer. Used when a
	 * lone player changes the map from the Esc panel. Null if `map` is not in
	 * the rotation.
	 */
	forceMap(map: string, now: number): RotationEvent | null {
		if (!this.maps.includes(map)) return null;
		return this.changeMap(map, now);
	}

	/**
	 * Add `seconds` to the current map (admin "extend"). Does not use up a
	 * vote extend. Null while a vote is open or a change is pending.
	 */
	extendBy(seconds: number, now: number): RotationEvent | null {
		if (this.vote || this.pending || !(seconds > 0)) return null;
		this.endsAt = Math.max(this.endsAt, now) + seconds * 1000;
		if (this.timeLeft(now) > VOTE_AT) this.scheduledVoteDone = false;
		return { type: 'extended', timeLeft: this.timeLeft(now) };
	}

	// -----------------------------------------------------------------------

	private requestEvent(started: boolean, now: number): RotationEvent {
		const r = this.request!;
		return {
			type: 'rtvRequest',
			started,
			initiator: r.initiator,
			mapId: r.mapId,
			duration: Math.max(0, (r.endsAt - now) / 1000),
			yes: r.yes.size,
			no: r.no.size,
			needed: r.needed
		};
	}

	/** Recompute the threshold; pass, decline (cannot reach it any more) or report changed counts. */
	private checkRequest(voters: number, now: number): RotationEvent[] {
		const r = this.request;
		if (!r) return [];
		const needed = MapRotation.rtvNeeded(voters);
		if (needed !== r.needed) {
			r.needed = needed;
			this.requestDirty = true;
		}
		if (r.yes.size >= needed) {
			const nominated = r.mapId;
			const ev: RotationEvent[] = [this.endRequest(true, 'passed', now)];
			ev.push(...this.openVote(now, true, nominated));
			return ev;
		}
		const undecided = Math.max(0, voters - r.yes.size - r.no.size);
		if (r.yes.size + undecided < needed) return [this.endRequest(false, 'rejected', now)];
		if (!this.requestDirty) return [];
		this.requestDirty = false;
		return [this.requestEvent(false, now)];
	}

	private endRequest(passed: boolean, reason: RtvRequestEndReason, now: number): RotationEvent {
		this.request = null;
		this.requestDirty = false;
		const declined = reason === 'timeout' || reason === 'rejected';
		if (declined) this.declinedUntil = now + RTV_DECLINE_COOLDOWN * 1000;
		return { type: 'rtvRequestEnd', passed, reason, cooldown: declined ? RTV_DECLINE_COOLDOWN : 0 };
	}

	private others(): string[] {
		return this.maps.filter((m) => m !== this._current && this.isEnabled(m));
	}

	private randomOther(): string | null {
		const o = this.others();
		if (o.length === 0) return null;
		return o[Math.min(o.length - 1, Math.floor(this.rng() * o.length))];
	}

	/**
	 * Vote options: VOTE_MAP_SLOTS random maps per category (enabled, not
	 * current), free slots filled from the other categories up to
	 * MAX_VOTE_MAPS, ordered by category. A nominated map takes a random slot
	 * of its own category (or a free one). The timed vote adds Extend last.
	 */
	private optionsFor(rtv: boolean, nominated: string | null = null): VoteOption[] {
		const pool = this.others();
		const nom = nominated !== null && pool.includes(nominated) ? nominated : null;
		const cats = Object.keys(VOTE_MAP_SLOTS);
		const byCat = new Map<string, string[]>();
		for (const m of pool) {
			const k = this.kindOf(m);
			const list = byCat.get(k) ?? [];
			list.push(m);
			byCat.set(k, list);
		}
		// One list of picks per category (known categories first, in VOTE_MAP_SLOTS order).
		const order = [...cats, ...[...byCat.keys()].filter((k) => !cats.includes(k))];
		const picks = new Map<string, string[]>(order.map((k) => [k, []]));
		const rest: string[] = [];
		for (const k of order) {
			const list = this.shuffle(byCat.get(k) ?? []);
			const n = VOTE_MAP_SLOTS[k] ?? 0;
			picks.get(k)!.push(...list.slice(0, n));
			rest.push(...list.slice(n));
		}
		let total = [...picks.values()].reduce((a, l) => a + l.length, 0);
		for (const m of this.shuffle(rest)) {
			if (total >= MAX_VOTE_MAPS) break;
			picks.get(this.kindOf(m))!.push(m);
			total++;
		}
		if (nom && !picks.get(this.kindOf(nom))!.includes(nom)) {
			const own = picks.get(this.kindOf(nom))!;
			if (own.length > 0) own[this.randomIndex(own.length)] = nom;
			else if (total < MAX_VOTE_MAPS) own.push(nom);
			else {
				// Replace a random fill slot (a map beyond its category's quota), else any slot.
				const fills = order.filter((k) => picks.get(k)!.length > (VOTE_MAP_SLOTS[k] ?? 0));
				const from = fills.length > 0 ? fills : order.filter((k) => picks.get(k)!.length > 0);
				const k = from[this.randomIndex(from.length)];
				picks.get(k)!.pop();
				own.push(nom);
			}
		}
		// Stable display order: by category, then rotation (map list) order.
		const rank = (m: string) => this.maps.indexOf(m);
		const opts: VoteOption[] = order
			.flatMap((k) => picks.get(k)!.sort((x, y) => rank(x) - rank(y)))
			.map((mapId) => ({ kind: 'map', mapId }));
		if (!rtv && this.extends < MAX_EXTENDS) opts.push({ kind: 'extend' });
		return opts;
	}

	private randomIndex(n: number): number {
		return Math.min(n - 1, Math.floor(this.rng() * n));
	}

	/** Fisher-Yates copy with the injected rng (deterministic in tests). */
	private shuffle<T>(list: readonly T[]): T[] {
		const a = [...list];
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.min(i, Math.floor(this.rng() * (i + 1)));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	}

	private openVote(now: number, rtv: boolean, nominated: string | null = null): RotationEvent[] {
		this.ballots.clear();
		const options = this.optionsFor(rtv, nominated);
		if (options.length === 0) return [];
		this.vote = {
			options,
			counts: options.map(() => 0),
			endsAt: now + VOTE_DURATION * 1000,
			rtv
		};
		this.countsDirty = false;
		return [{ type: 'voteStart', options: options.slice(), duration: VOTE_DURATION, rtv }];
	}

	private recount(): void {
		const v = this.vote;
		if (!v) return;
		v.counts.fill(0);
		for (const idx of this.ballots.values()) if (idx < v.counts.length) v.counts[idx]++;
	}

	private resolve(now: number): RotationEvent[] {
		const v = this.vote!;
		this.vote = null;
		this.ballots.clear();
		this.countsDirty = false;
		const max = Math.max(...v.counts);
		let winner: VoteOption;
		if (max <= 0) {
			const m = this.randomOther();
			winner = m ? { kind: 'map', mapId: m } : { kind: 'extend' };
		} else {
			const tied = v.options.filter((_, i) => v.counts[i] === max);
			winner = tied[Math.min(tied.length - 1, Math.floor(this.rng() * tied.length))];
		}

		if (winner.kind === 'extend') {
			this.extends++;
			this.endsAt += EXTEND_DURATION * 1000;
			this.scheduledVoteDone = false;
			return [
				{ type: 'voteEnd', winner, countdown: 0 },
				{ type: 'extended', timeLeft: this.timeLeft(now) }
			];
		}
		this.pending = { map: winner.mapId, at: now + CHANGE_COUNTDOWN * 1000 };
		return [{ type: 'voteEnd', winner, countdown: CHANGE_COUNTDOWN }];
	}

	private changeMap(map: string, now: number): RotationEvent {
		this._current = map;
		this.pending = null;
		this.vote = null;
		this.ballots.clear();
		this.request = null;
		this.requestDirty = false;
		this.declinedUntil = -Infinity;
		this.extends = 0;
		this.scheduledVoteDone = false;
		this.mapStartedAt = now;
		this.endsAt = now + this.duration * 1000;
		return { type: 'mapChange', map, timeLeft: this.duration };
	}
}
