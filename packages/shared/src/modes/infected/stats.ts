/**
 * Round stats of infected (docs/modes.md#infected): per-player tallies kept
 * beside score/kills/deaths for the round summary (`end.stats`). They reset
 * with the score at every grace period and follow a player through a leave
 * and rejoin like the score does.
 */
import type { InfRoundStat, InfTeam } from './game.ts';

export interface InfTally {
	/** Gun trigger pulls while a round is being played. */
	shots: number;
	/** Trigger pulls that hit at least one player. */
	hits: number;
	/** Trigger pulls that hit at least one player in the head (never more than `hits`). */
	headshots: number;
	/** Infected killed as a survivor (a M.O.A.B. wipe included). */
	kills: number;
	/** Survivors infected. */
	infections: number;
	/** Longest survivor kill streak. */
	bestStreak: number;
	/** Time survived as a survivor until turned or gone (ms); survivors at the end get the whole round. */
	survivedMs: number;
	/** Was Patient Zero. */
	alpha: boolean;
}

export function newInfTally(): InfTally {
	return { shots: 0, hits: 0, headshots: 0, kills: 0, infections: 0, bestStreak: 0, survivedMs: 0, alpha: false };
}

/** Summary row of one player; `roundSecs` is the length of the round (the `secs` of the `end` event). */
export function infRoundStat(
	p: { id: number; team: InfTeam; score: number; deaths: number },
	t: Readonly<InfTally>,
	roundSecs: number
): InfRoundStat {
	const survived = p.team === 'survivor' ? roundSecs : Math.min(roundSecs, Math.round(t.survivedMs / 100) / 10);
	return {
		id: p.id,
		team: p.team,
		alpha: t.alpha,
		score: p.score,
		kills: t.kills,
		infections: t.infections,
		deaths: p.deaths,
		shots: t.shots,
		hits: t.hits,
		headshots: t.headshots,
		bestStreak: t.bestStreak,
		survivedSecs: Math.max(0, survived)
	};
}
