/** Server gamemode factory (docs/modes.md). */
import { modeOf } from '@surf/shared';
import { InfectedMode, type InfectedModeOptions } from './infected.ts';
import { RaceMode } from './race.ts';
import { TagMode, type TagModeOptions } from './tag.ts';
import type { ModeHost, ServerMode } from './types.ts';
import { ZombiesMode, type ZombiesModeOptions } from './zombies.ts';

export interface ModeOptions {
	infected?: InfectedModeOptions;
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
		case 'infected':
			return new InfectedMode(host, opts.infected);
	}
}

export type { ModeHost, ModePlayer, ServerMode } from './types.ts';
export { InfectedMode, RaceMode, TagMode, ZombiesMode };
