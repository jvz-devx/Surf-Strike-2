/**
 * Practice range hint of InfectedHud.svelte (docs/ui.md): the text of the
 * waiting banner and the keys under it while the range is open. No DOM, no
 * Svelte: unit-tested in node.
 */
import { WEAPONS } from '@surf/shared';
import type { InfectedView } from '#lib/game/contract.js';

export interface PracticeKey {
	key: string;
	label: string;
}

export interface PracticeHint {
	/** Banner text in place of the plain waiting line. */
	title: string;
	keys: PracticeKey[];
}

export const PRACTICE_TITLE = 'Practice range · a round needs 2+ players';

/**
 * The hint while the practice range is open (no round, not spectating), else
 * null. The keys follow the held weapon: a gun aims down its sights on RMB
 * (the two scoped rifles look through the scope), and reloads.
 */
export function practiceHint(v: Pick<InfectedView, 'practice' | 'phase' | 'spectating' | 'weapon'>): PracticeHint | null {
	if (!v.practice || v.spectating || (v.phase !== 'waiting' && v.phase !== 'solo')) return null;
	const def = WEAPONS[v.weapon];
	const gun = def.magazine > 0;
	const keys: PracticeKey[] = [{ key: 'LMB', label: gun ? 'Fire' : 'Swing' }];
	if (gun) keys.push({ key: 'RMB', label: def.zoomFov !== null ? 'Scope' : 'Aim' });
	if (gun) keys.push({ key: 'R', label: 'Reload' });
	keys.push({ key: '1 2 3', label: 'Weapons' }, { key: '4', label: 'Next primary' });
	return { title: PRACTICE_TITLE, keys };
}
