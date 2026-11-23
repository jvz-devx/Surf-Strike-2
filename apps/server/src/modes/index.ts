/** Server gamemode factory (docs/modes.md). */
import { modeOf } from '@surf/shared';
import { RaceMode } from './race.ts';
import { TagMode, type TagModeOptions } from './tag.ts';
import type { ModeHost, ServerMode } from './types.ts';
import { ZombiesMode, type ZombiesModeOptions } from './zombies.ts';

export interface ModeOptions {
	tag?: TagModeOptions;
	zombies?: ZombiesModeOptions;
}

export function createServerMode(host: ModeHost, opts: ModeOptions = {}): ServerMode {
	const mode = modeOf(host.map);
	switch (mode.family) {
		case 'race':
			return new RaceMode(host);
		case 'tag':
			return new TagMode(host, opts.tag);
		case 'coop':
			return new ZombiesMode(host, opts.zombies);
		case 'hns':
			// Placeholder until HnsMode lands (docs/modes.md#hide-and-seek).
			return new TagMode(host, opts.tag);
	}
}

export type { ModeHost, ModePlayer, ServerMode } from './types.ts';
export { RaceMode, TagMode, ZombiesMode };
