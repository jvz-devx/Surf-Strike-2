<script lang="ts">
	import { tick } from 'svelte';
	import type { ChatLine, GameApi } from '#lib/game/contract.js';
	import { fadeOpacity } from '#lib/ui/format.js';

	let { lines, open, now, api }: { lines: ChatLine[]; open: boolean; now: number; api: GameApi } = $props();

	const FADE_HOLD = 8000;
	const FADE_OUT = 1000;
	const MAX_LEN = 128;

	let text = $state('');
	let input: HTMLInputElement | undefined = $state();
	let log: HTMLDivElement | undefined = $state();

	// Closed: only recent lines, fading. Open: full history (scrollable).
	const visible = $derived(
		open
			? lines.map((l) => ({ line: l, opacity: 1 }))
			: lines
					.slice(-8)
					.map((l) => ({ line: l, opacity: fadeOpacity(now - l.at, FADE_HOLD, FADE_OUT) }))
					.filter((v) => v.opacity > 0)
	);

	$effect(() => {
		if (!open) return;
		text = '';
		void tick().then(() => input?.focus());
		// The key that opened chat may land in the freshly focused input; drop it.
		const t = setTimeout(() => (text = ''), 0);
		return () => clearTimeout(t);
	});

	// Keep the log scrolled to the newest line.
	$effect(() => {
		void lines.length;
		void open;
		void tick().then(() => {
			if (log) log.scrollTop = log.scrollHeight;
		});
	});

	function onkeydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Enter') {
			e.preventDefault();
			const msg = text.trim();
			text = '';
			if (msg) api.sendChat(msg.slice(0, MAX_LEN));
			api.closeChat();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			text = '';
			api.closeChat();
		}
	}
</script>

<div class="chat" class:open>
	<div class="log" class:scroll={open} bind:this={log} aria-live="polite">
		{#each visible as { line, opacity } (line.id)}
			<div class="line ss-shadow" class:system={line.system || line.from === null} style:opacity>
				{#if line.from !== null && !line.system}{#if line.admin}<span class="admin" title="Server admin">ADMIN</span>{/if}<span class="from">{line.from}:</span>{/if}
				<span class="text">{line.text}</span>
			</div>
		{/each}
	</div>
	{#if open}
		<div class="inputrow ss-overlay">
			<label for="ss-chat-input" class="ss-label">Say</label>
			<input
				id="ss-chat-input"
				class="ss-input"
				bind:this={input}
				bind:value={text}
				maxlength={MAX_LEN}
				autocomplete="off"
				spellcheck="false"
				{onkeydown}
			/>
		</div>
	{/if}
</div>

<style>
	.chat {
		width: min(460px, 36vw);
		display: flex;
		flex-direction: column;
		gap: 6px;
		pointer-events: none;
	}
	.chat.open {
		pointer-events: auto;
	}
	.log {
		display: flex;
		flex-direction: column;
		gap: 1px;
		max-height: calc(8 * 1.45em);
		overflow: hidden;
		font-size: calc(15px * var(--hud-scale));
		padding: 4px 6px;
		border-radius: var(--radius);
	}
	.log.scroll {
		max-height: 34vh;
		overflow-y: auto;
		background: var(--panel-bg);
		border: 1px solid var(--panel-border);
		backdrop-filter: var(--panel-blur);
	}
	.line {
		line-height: 1.4;
		overflow-wrap: anywhere;
		transition: opacity 200ms linear;
	}
	.admin {
		margin-right: 5px;
		padding: 0 4px;
		font-size: 0.75em;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: #14161a;
		background: var(--accent);
		border-radius: 2px;
		vertical-align: 1px;
	}
	.from {
		font-weight: 700;
		color: var(--info);
		margin-right: 4px;
	}
	.system .text {
		color: var(--system);
	}
	.inputrow {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 6px;
		background: var(--panel-bg-strong);
		border: 1px solid var(--panel-border);
		border-radius: var(--radius);
	}
	.inputrow .ss-label {
		color: var(--accent);
	}
	.inputrow input {
		flex: 1;
		min-width: 0;
		padding: 5px 7px;
	}
</style>
