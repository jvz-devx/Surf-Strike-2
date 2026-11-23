/**
 * Fullscreen with the Keyboard Lock API (docs/ui.md#platform): the one mode in which a tab can
 * receive and cancel Ctrl+W. Chromium only; elsewhere `supported` is false and every call is a
 * no-op. The whole page goes fullscreen, not only the canvas, so the HUD stays visible.
 */
import { LOCK_KEYS } from './guard.js';

export interface KeyboardLockApi {
	lock(keys?: readonly string[]): Promise<void>;
	unlock(): void;
}

/** The Keyboard Lock API, when fullscreen can be requested too (secure Chromium pages); else null. */
export function keyboardLockApi(nav: unknown, doc: unknown): KeyboardLockApi | null {
	const kb = (nav as { keyboard?: Partial<KeyboardLockApi> } | undefined)?.keyboard;
	if (typeof kb?.lock !== 'function' || typeof kb.unlock !== 'function') return null;
	return (doc as { fullscreenEnabled?: boolean } | undefined)?.fullscreenEnabled === true ? (kb as KeyboardLockApi) : null;
}

export class GameFullscreen {
	private readonly kb: KeyboardLockApi | null;
	/** We put the page into fullscreen (leave it alone otherwise). */
	private entered = false;

	constructor(
		/** Result of each keyboard lock request: true = Ctrl+W is blocked while in fullscreen. */
		private onLock: (ok: boolean) => void = () => {},
		private doc: Document = document,
		private nav: Navigator = navigator
	) {
		this.kb = keyboardLockApi(nav, doc);
		doc.addEventListener('fullscreenchange', this.onChange);
	}

	get supported(): boolean {
		return this.kb !== null;
	}

	get active(): boolean {
		return this.doc.fullscreenElement !== null;
	}

	/** Call with a user gesture still active (a click or key press); silent when refused. */
	enter(): void {
		if (!this.kb) return;
		if (this.active) return this.lockKeys(); // refused earlier, e.g. the window had no focus
		if (this.nav.userActivation?.isActive === false) return;
		this.doc.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(
			() => {
				this.entered = true;
			},
			() => {}
		);
	}

	exit(): void {
		if (!this.entered || !this.active) return;
		this.doc.exitFullscreen().catch(() => {});
	}

	dispose(): void {
		this.doc.removeEventListener('fullscreenchange', this.onChange);
		this.kb?.unlock();
		this.exit();
	}

	/** When refused (some Chromium versions ask the player), the leave-page prompt (input.ts) still guards. */
	private lockKeys(): void {
		this.kb?.lock(LOCK_KEYS).then(
			() => this.onLock(true),
			() => this.onLock(false)
		);
	}

	private onChange = (): void => {
		if (!this.kb) return;
		if (this.active) this.lockKeys();
		else {
			this.entered = false;
			this.kb.unlock();
		}
	};
}
