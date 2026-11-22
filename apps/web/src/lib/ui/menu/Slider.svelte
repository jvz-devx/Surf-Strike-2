<script lang="ts">
	/** Labelled range row; with `numberField` also an editable number box, else a read-out. */
	let {
		id,
		label,
		value,
		min,
		max,
		step,
		onset,
		numberField = false,
		numMin = min,
		numMax = max,
		numStep = step,
		format = (v: number) => String(v)
	}: {
		id: string;
		label: string;
		value: number;
		min: number;
		max: number;
		step: number;
		onset: (v: number) => void;
		numberField?: boolean;
		numMin?: number;
		numMax?: number;
		numStep?: number;
		format?: (v: number) => string;
	} = $props();

	function read(e: Event) {
		const v = Number((e.currentTarget as HTMLInputElement).value);
		if (Number.isFinite(v)) onset(v);
	}
</script>

<div class="row">
	<label for={id}>{label}</label>
	<div class="ctl">
		<input
			id={numberField ? `${id}-range` : id}
			type="range"
			aria-label={numberField ? `${label} slider` : undefined}
			{min}
			{max}
			{step}
			{value}
			oninput={read}
		/>
		{#if numberField}
			<input
				{id}
				class="ss-input num ss-num"
				type="number"
				min={numMin}
				max={numMax}
				step={numStep}
				{value}
				onchange={read}
			/>
		{:else}
			<output class="ss-num" for={id}>{format(value)}</output>
		{/if}
	</div>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: 150px 1fr;
		align-items: center;
		gap: 14px;
		min-height: 34px;
	}
	label {
		color: var(--text-dim);
		font-size: 15px;
	}
	.ctl {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	input[type='range'] {
		flex: 1;
		min-width: 0;
		accent-color: var(--accent);
	}
	.num {
		width: 76px;
		padding: 4px 6px;
		font-size: 15px;
		font-weight: 600;
	}
	output {
		width: 76px;
		text-align: right;
		font-weight: 600;
		font-size: 16px;
	}
</style>
