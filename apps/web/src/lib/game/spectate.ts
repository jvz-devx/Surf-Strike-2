/** Spectator target selection helpers. */
export interface SpecCandidate {
	id: number;
	name: string;
	spectating: boolean;
}

/** Players that can be spectated (not self, not spectating), sorted by id. */
export function specTargets(players: Iterable<SpecCandidate>, selfId: number): SpecCandidate[] {
	return [...players].filter((p) => p.id !== selfId && !p.spectating).sort((a, b) => a.id - b.id);
}

/** Next/previous target id after `current` (wraps). */
export function cycleTarget(targets: readonly SpecCandidate[], current: number | null, dir: 1 | -1): number | null {
	if (targets.length === 0) return null;
	const i = current === null ? -1 : targets.findIndex((t) => t.id === current);
	if (i < 0) return dir === 1 ? targets[0].id : targets[targets.length - 1].id;
	return targets[(i + dir + targets.length) % targets.length].id;
}

/** Find a target by name: exact (case-insensitive), then prefix, then substring. */
export function findTargetByName(targets: readonly SpecCandidate[], query: string): number | null {
	const q = query.trim().toLowerCase();
	if (!q) return null;
	const by = (f: (n: string) => boolean) => targets.find((t) => f(t.name.toLowerCase()))?.id ?? null;
	return by((n) => n === q) ?? by((n) => n.startsWith(q)) ?? by((n) => n.includes(q));
}
