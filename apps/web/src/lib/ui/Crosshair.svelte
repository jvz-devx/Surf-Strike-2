<script lang="ts">
	import { crosshairRects, cvarNum } from '#lib/ui/format.js';

	let { cvars }: { cvars: Record<string, number | string> } = $props();

	const rects = $derived(
		crosshairRects(
			cvarNum(cvars, 'cl_crosshairsize', 5),
			cvarNum(cvars, 'cl_crosshairgap', 1),
			cvarNum(cvars, 'cl_crosshairthickness', 1),
			cvarNum(cvars, 'cl_crosshairdot', 0) !== 0
		)
	);
	const color = $derived(
		`rgb(${cvarNum(cvars, 'cl_crosshaircolor_r', 0)}, ${cvarNum(cvars, 'cl_crosshaircolor_g', 255)}, ${cvarNum(cvars, 'cl_crosshaircolor_b', 0)})`
	);
</script>

<div class="crosshair" aria-hidden="true">
	{#each rects as r, i (i)}
		<i
			style:left="{r.x}px"
			style:top="{r.y}px"
			style:width="{r.w}px"
			style:height="{r.h}px"
			style:background={color}
		></i>
	{/each}
</div>

<style>
	.crosshair {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 0;
		height: 0;
	}
	i {
		position: absolute;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55);
	}
</style>
