<script lang="ts">
	let {
		keys
	}: { keys: { w: boolean; a: boolean; s: boolean; d: boolean; jump: boolean; duck: boolean } } = $props();
</script>

<div class="keys ss-shadow" aria-hidden="true">
	<div class="row"><span class="k" class:on={keys.w}>W</span></div>
	<div class="row">
		<span class="k" class:on={keys.a}>A</span><span class="k" class:on={keys.s}>S</span><span
			class="k"
			class:on={keys.d}>D</span
		>
	</div>
	<div class="row">
		<span class="k wide" class:on={keys.jump}>Jump</span><span class="k wide" class:on={keys.duck}>Duck</span>
	</div>
</div>

<style>
	.keys {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
	}
	.row {
		display: flex;
		gap: 3px;
	}
	.k {
		min-width: 26px;
		height: 24px;
		display: grid;
		place-items: center;
		font: 700 12px/1 var(--ui-font);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-faint);
		background: rgba(12, 14, 18, 0.35);
		border: 1px solid var(--panel-border);
		border-radius: 2px;
	}
	.wide {
		min-width: 41px;
	}
	.on {
		color: #14161a;
		background: rgba(238, 241, 245, 0.88);
		text-shadow: none;
	}
</style>
