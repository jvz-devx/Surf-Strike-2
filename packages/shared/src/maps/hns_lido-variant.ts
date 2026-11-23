/**
 * The two sizes of "Lido Bay" (docs/maps.md): Large is the whole resort,
 * Medium its western quarters (hotel, old town, plaza, maze, beach, pier,
 * lighthouse) closed at x = 1280. Both come from the same area modules; a
 * variant only moves the east boundary, the sewer's east end and what stands
 * at the cut.
 */
import { rect, type Rect } from './hns-props.ts';

export interface LidoVariant {
	size: 'medium' | 'large';
	/** Playable area (inner faces of the boundary). */
	arena: Rect;
	/** East end of the sewer tunnel (underpass stairs climb the last 288 units). */
	sewerX1: number;
}

export const LARGE: LidoVariant = { size: 'large', arena: rect(-4608, 4608, -3840, 3840), sewerX1: 1472 };
export const MEDIUM: LidoVariant = { size: 'medium', arena: rect(-4608, 1280, -3840, 3840), sewerX1: 1152 };
