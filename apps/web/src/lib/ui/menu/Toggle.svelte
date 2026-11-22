<script lang="ts">
	/** Labelled on/off row for a 0/1 cvar. */
	let {
		label,
		hint = '',
		checked,
		onset
	}: { label: string; hint?: string; checked: boolean; onset: (on: boolean) => void } = $props();
</script>

<label class="row">
	<span class="text">
		<span class="label">{label}</span>
		{#if hint}<span class="hint">{hint}</span>{/if}
	</span>
	<input
		type="checkbox"
		class="switch"
		{checked}
		onchange={(e) => onset((e.currentTarget as HTMLInputElement).checked)}
	/>
</label>

<style>
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		min-height: 34px;
		cursor: pointer;
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.label {
		color: var(--text-dim);
		font-size: 15px;
	}
	.row:hover .label {
		color: var(--text);
	}
	.hint {
		font-size: 12px;
		color: var(--text-faint);
	}
	.switch {
		appearance: none;
		flex-shrink: 0;
		position: relative;
		width: 38px;
		height: 20px;
		margin: 0;
		border: 1px solid var(--panel-border-strong);
		border-radius: 10px;
		background: rgba(0, 0, 0, 0.45);
		cursor: pointer;
		transition: background 0.12s;
	}
	.switch::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--text-dim);
		transition: transform 0.12s;
	}
	.switch:checked {
		background: var(--accent-soft);
		border-color: var(--accent);
	}
	.switch:checked::after {
		transform: translateX(18px);
		background: var(--accent);
	}
</style>
