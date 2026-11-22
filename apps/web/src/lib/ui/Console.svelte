<script lang="ts">
	import { tick } from 'svelte';
	import type { ConsoleLine, GameApi } from '#lib/game/contract.js';
	import { commonPrefix } from '#lib/ui/format.js';

	let { lines, api, isOpen }: { lines: ConsoleLine[]; api: GameApi; isOpen: () => boolean } = $props();

	let text = $state('');
	let input: HTMLInputElement | undefined = $state();
	let log: HTMLDivElement | undefined = $state();

	// History navigation: index into api.history(); null = editing a fresh line.
	let histIndex: number | null = null;
	let draft = '';

	// Tab completion state: candidates for the current prefix and cycle position.
	let candidates: string[] = $state([]);
	let cycle = $state(-1);
	let cycleBase = '';

	$effect(() => {
		void tick().then(() => input?.focus());
		// The toggle key that opened the console may land in the input; drop it.
		const t = setTimeout(() => {
			if (text === '`' || text === '~') text = '';
		}, 0);
		return () => clearTimeout(t);
	});

	$effect(() => {
		void lines.length;
		void tick().then(() => {
			if (log) log.scrollTop = log.scrollHeight;
		});
	});

	function resetCompletion() {
		candidates = [];
		cycle = -1;
	}

	function close() {
		// The engine may also handle the toggle key itself (capture phase); only
		// toggle if it is still open after the event has finished dispatching.
		setTimeout(() => {
			if (isOpen()) api.toggleConsole();
		}, 0);
	}

	function complete() {
		// Complete the first word (command/cvar name) only.
		if (text.includes(' ')) return;
		if (cycle >= 0 && candidates.length > 1) {
			cycle = (cycle + 1) % candidates.length;
			text = candidates[cycle] + ' ';
			return;
		}
		const prefix = text;
		const found = api.complete(prefix);
		if (found.length === 0) {
			resetCompletion();
			return;
		}
		if (found.length === 1) {
			text = found[0] + ' ';
			resetCompletion();
			return;
		}
		candidates = found;
		cycleBase = prefix;
		const common = commonPrefix(found);
		if (common.length > prefix.length) {
			text = common;
			cycle = -1;
		} else {
			cycle = 0;
			text = found[0] + ' ';
		}
	}

	function onkeydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === '`' || e.key === '~' || e.key === 'Escape') {
			e.preventDefault();
			close();
			return;
		}
		if (e.key === 'Tab') {
			e.preventDefault();
			complete();
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			const line = text.trim();
			text = '';
			histIndex = null;
			resetCompletion();
			if (line) api.exec(line);
			return;
		}
		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			const hist = api.history();
			if (hist.length === 0) return;
			if (e.key === 'ArrowUp') {
				if (histIndex === null) {
					draft = text;
					histIndex = hist.length - 1;
				} else histIndex = Math.max(0, histIndex - 1);
				text = hist[histIndex] ?? '';
			} else {
				if (histIndex === null) return;
				if (histIndex >= hist.length - 1) {
					histIndex = null;
					text = draft;
				} else {
					histIndex += 1;
					text = hist[histIndex] ?? '';
				}
			}
			resetCompletion();
			return;
		}
	}

	function oninput() {
		histIndex = null;
		if (cycle >= 0 || candidates.length) {
			if (!text.startsWith(cycleBase)) resetCompletion();
			else {
				cycle = -1;
				candidates = [];
			}
		}
	}
</script>

<section class="console ss-overlay" aria-label="Developer console">
	<div class="title"><span class="ss-label">Console</span></div>
	<div class="log ss-num" bind:this={log} role="log">
		{#each lines as l (l.id)}
			<div class="line {l.kind}">{l.text}</div>
		{/each}
	</div>
	{#if candidates.length > 1}
		<div class="cands" aria-live="polite">
			{#each candidates.slice(0, 40) as c, i (c)}
				<span class:active={i === cycle}>{c}</span>
			{/each}
			{#if candidates.length > 40}<span class="more">+{candidates.length - 40} more</span>{/if}
		</div>
	{/if}
	<div class="inputrow">
		<label for="ss-console-input" class="prompt">&gt;</label>
		<input
			id="ss-console-input"
			class="ss-num"
			aria-label="Console command"
			bind:this={input}
			bind:value={text}
			autocomplete="off"
			spellcheck="false"
			{onkeydown}
			{oninput}
		/>
	</div>
</section>

<style>
	.console {
		position: absolute;
		left: 50%;
		top: 0;
		transform: translateX(-50%);
		width: min(1100px, calc(100vw - 48px));
		height: 48vh;
		display: flex;
		flex-direction: column;
		background: rgba(10, 11, 14, 0.9);
		border: 1px solid var(--panel-border);
		border-top: none;
		border-radius: 0 0 var(--radius) var(--radius);
		backdrop-filter: var(--panel-blur);
		pointer-events: auto;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
	}
	.title {
		padding: 6px 12px;
		border-bottom: 1px solid var(--panel-border);
	}
	.log {
		flex: 1;
		overflow-y: auto;
		padding: 8px 12px;
		font-size: 15px;
		font-weight: 500;
		line-height: 1.3;
		user-select: text;
	}
	.line {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: rgba(238, 241, 245, 0.86);
	}
	.line.input {
		color: var(--accent);
	}
	.line.input::before {
		content: '] ';
		color: var(--text-faint);
	}
	.line.echo {
		color: var(--info);
	}
	.line.error {
		color: var(--bad);
	}
	.cands {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		padding: 6px 12px;
		border-top: 1px solid var(--panel-border);
		font: 500 14px/1.2 var(--num-font);
		color: var(--text-dim);
		max-height: 7em;
		overflow: hidden;
	}
	.cands .active {
		color: var(--text);
		text-decoration: underline;
	}
	.inputrow {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px 8px;
		border-top: 1px solid var(--panel-border);
	}
	.prompt {
		color: var(--accent);
		font-weight: 700;
	}
	input {
		flex: 1;
		font-size: 16px;
		font-weight: 600;
		color: var(--text);
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid var(--panel-border);
		border-radius: 2px;
		padding: 5px 8px;
		outline: none;
	}
	input:focus {
		border-color: var(--accent);
	}
</style>
