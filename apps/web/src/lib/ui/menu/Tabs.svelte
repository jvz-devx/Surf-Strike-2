<script lang="ts">
	import { wrapIndex } from '#lib/ui/menu/menu.js';

	/** Tab strip (roving focus: Left/Right/Home/End move and select). */
	let {
		tabs,
		selected,
		onselect,
		label,
		idPrefix
	}: {
		tabs: { id: string; label: string; count?: number }[];
		selected: string;
		onselect: (id: string) => void;
		label: string;
		idPrefix: string;
	} = $props();

	let strip: HTMLDivElement | undefined = $state();

	function keydown(e: KeyboardEvent) {
		const i = tabs.findIndex((t) => t.id === selected);
		let next = -1;
		if (e.key === 'ArrowRight') next = wrapIndex(i, 1, tabs.length);
		else if (e.key === 'ArrowLeft') next = wrapIndex(i, -1, tabs.length);
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = tabs.length - 1;
		if (next < 0) return;
		e.preventDefault();
		onselect(tabs[next].id);
		strip?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
	}
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="tabs" role="tablist" aria-label={label} bind:this={strip} onkeydown={keydown}>
	{#each tabs as t (t.id)}
		{@const on = t.id === selected}
		<button
			type="button"
			role="tab"
			id="{idPrefix}-tab-{t.id}"
			aria-selected={on}
			aria-controls="{idPrefix}-panel"
			tabindex={on ? 0 : -1}
			class:on
			onclick={() => onselect(t.id)}
		>
			{t.label}
			{#if t.count !== undefined}<span class="count ss-num">{t.count}</span>{/if}
		</button>
	{/each}
</div>

<style>
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		border-bottom: 1px solid var(--panel-border);
	}
	button {
		display: flex;
		align-items: baseline;
		gap: 6px;
		padding: 8px 14px 9px;
		margin-bottom: -1px;
		font: 600 13px/1 var(--ui-font);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-dim);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
	}
	button:hover {
		color: var(--text);
	}
	button.on {
		color: var(--text);
		border-bottom-color: var(--accent);
	}
	.count {
		font-size: 12px;
		color: var(--text-faint);
		letter-spacing: 0;
	}
	button.on .count {
		color: var(--accent);
	}
</style>
