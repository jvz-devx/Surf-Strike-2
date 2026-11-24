/** Pictures of items, drawn by the character preview when their card comes into view (docs/ui.md#shop). */
import { getCosmetic } from '@surf/shared';
import type { CharacterPreviewHandle } from '#lib/game/contract.js';

/** Kept while the page lives, so opening a menu again is instant. The default look has the player's own colours: not kept. */
const kept = new Map<string, string>();

export class ItemPictures {
	/** Item id to data URL. */
	readonly urls: Record<string, string> = $state({});
	/** Wanted whether on screen or not. */
	private readonly wanted = new Set<string>();
	private preview: CharacterPreviewHandle | null = null;
	private readonly visible = new Map<Element, string>();
	private readonly ids = new WeakMap<Element, string>();
	private queued = false;
	private readonly observer =
		typeof IntersectionObserver === 'undefined'
			? null
			: new IntersectionObserver((changes) => {
					for (const c of changes) {
						const id = this.ids.get(c.target);
						if (c.isIntersecting && id !== undefined) this.visible.set(c.target, id);
						else this.visible.delete(c.target);
					}
					this.queue();
				});

	/** Attachment of a card: draws the picture of `id` once it is on screen. */
	watch(id: string | null) {
		return (el: Element) => {
			if (id === null) return;
			const url = kept.get(id);
			if (url !== undefined) {
				this.urls[id] = url;
				return;
			}
			this.ids.set(el, id);
			this.observer?.observe(el);
			return () => {
				this.observer?.unobserve(el);
				this.visible.delete(el);
				this.queue();
			};
		};
	}

	/** Draw these soon, on screen or not (the loot box reel). */
	want(ids: readonly string[]): void {
		for (const id of ids) {
			const url = kept.get(id);
			if (url !== undefined) this.urls[id] = url;
			else this.wanted.add(id);
		}
		this.queue();
	}

	setPreview(p: CharacterPreviewHandle | null): void {
		this.preview = p;
		this.queue();
	}

	dispose(): void {
		this.preview = null;
		this.observer?.disconnect();
		this.visible.clear();
		this.wanted.clear();
	}

	/** Ask for the visible pictures that are missing (replaces the last request), once per task. */
	private queue(): void {
		if (this.queued) return;
		this.queued = true;
		queueMicrotask(() => {
			this.queued = false;
			const missing = [...new Set([...this.visible.values(), ...this.wanted])].filter((id) => !(id in this.urls));
			this.preview?.thumbnails(missing, (id, url) => {
				this.urls[id] = url;
				if (!getCosmetic(id)?.isDefault) kept.set(id, url);
			});
		});
	}
}
