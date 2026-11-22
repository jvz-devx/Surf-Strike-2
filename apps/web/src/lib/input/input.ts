/**
 * Raw input: keyboard, mouse buttons, wheel and pointer-locked mouse motion.
 * Translates DOM events into bind key names; the game decides what to do.
 */
import { keyNameFromCode, mouseButtonName } from './keys.js';

export interface InputHandlers {
	/** Return true if the event was consumed (preventDefault). */
	key(name: string, down: boolean, e: KeyboardEvent): boolean;
	/** Mouse buttons and wheel ("mouse1", "mwheeldown"); only while pointer-locked. `t` = Event.timeStamp (ms). */
	button(name: string, down: boolean, t: number): void;
	wheel(name: string, t: number): void;
	pointerLock(locked: boolean): void;
	canvasClick(): void;
	/** First user gesture (resume audio). */
	gesture(): void;
	/** Window lost focus: release all held keys. */
	blur(): void;
}

export class Input {
	/** Mouse counts accumulated since the last consume. */
	dx = 0;
	dy = 0;
	locked = false;
	private off: Array<() => void> = [];

	constructor(
		private canvas: HTMLCanvasElement,
		private h: InputHandlers
	) {
		const on = <K extends keyof WindowEventMap>(
			t: Window | Document | HTMLElement,
			type: K | string,
			fn: (e: never) => void,
			opts?: AddEventListenerOptions
		) => {
			t.addEventListener(type, fn as EventListener, opts);
			this.off.push(() => t.removeEventListener(type, fn as EventListener, opts));
		};

		// Capture phase: the engine sees keys before UI inputs handle them.
		on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e, true), { capture: true });
		on(window, 'keyup', (e: KeyboardEvent) => this.onKey(e, false), { capture: true });
		on(document, 'mousemove', (e: MouseEvent) => {
			if (!this.locked) return;
			this.dx += e.movementX;
			this.dy += e.movementY;
		});
		on(window, 'mousedown', (e: MouseEvent) => {
			this.h.gesture();
			if (this.locked) {
				e.preventDefault();
				this.h.button(mouseButtonName(e.button), true, e.timeStamp);
			}
		});
		on(window, 'mouseup', (e: MouseEvent) => {
			if (this.locked) this.h.button(mouseButtonName(e.button), false, e.timeStamp);
		});
		on(
			window,
			'wheel',
			(e: WheelEvent) => {
				if (!this.locked || e.deltaY === 0) return;
				e.preventDefault();
				this.h.wheel(e.deltaY > 0 ? 'mwheeldown' : 'mwheelup', e.timeStamp);
			},
			{ passive: false }
		);
		on(window, 'contextmenu', (e: MouseEvent) => {
			if (this.locked || e.target === this.canvas) e.preventDefault();
		});
		on(canvas, 'click', () => this.h.canvasClick());
		on(document, 'pointerlockchange', () => {
			const locked = document.pointerLockElement === this.canvas;
			if (locked === this.locked) return;
			this.locked = locked;
			this.dx = this.dy = 0;
			this.h.pointerLock(locked);
		});
		on(window, 'blur', () => this.h.blur());
	}

	private onKey(e: KeyboardEvent, down: boolean): void {
		if (down) this.h.gesture();
		const name = keyNameFromCode(e.code, e.key);
		if (!name) return;
		if (this.h.key(name, down, e)) e.preventDefault();
	}

	consumeMouse(out: { dx: number; dy: number }): void {
		out.dx = this.dx;
		out.dy = this.dy;
		this.dx = this.dy = 0;
	}

	requestLock(): void {
		if (this.locked) return;
		const c = this.canvas as HTMLCanvasElement & {
			requestPointerLock(opts?: { unadjustedMovement?: boolean }): Promise<void> | void;
		};
		try {
			// Raw (unaccelerated) input where supported; fall back silently.
			const p = c.requestPointerLock({ unadjustedMovement: true });
			if (p && typeof p.catch === 'function') {
				p.catch(() => {
					try {
						const q = c.requestPointerLock();
						if (q && typeof q.catch === 'function') q.catch(() => {});
					} catch {
						// ignore
					}
				});
			}
		} catch {
			try {
				c.requestPointerLock();
			} catch {
				// ignore
			}
		}
	}

	exitLock(): void {
		if (document.pointerLockElement === this.canvas) document.exitPointerLock();
	}

	dispose(): void {
		for (const f of this.off) f();
		this.off = [];
		this.exitLock();
	}
}
