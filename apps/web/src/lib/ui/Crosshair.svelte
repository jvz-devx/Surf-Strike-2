<script lang="ts">
	import { innerHeight } from 'svelte/reactivity/window';
	import { spreadGapPx } from '#lib/game/gunfeel.js';
	import { crosshairRects, cvarNum } from '#lib/ui/format.js';

	let {
		cvars,
		spreadDeg,
		opacity = 1
	}: {
		cvars: Record<string, number | string>;
		/** Current aim spread half-angle (degrees): the lines open to its edge. Absent or 0: the cvar gap only. */
		spreadDeg?: number;
		/** Fades out while the sights come up (infected aim down sights). */
		opacity?: number;
	} = $props();

	const spreadPx = $derived(spreadDeg ? spreadGapPx(spreadDeg, cvarNum(cvars, 'fov', 90), innerHeight.current ?? 0) : 0);
	const rects = $derived(
		crosshairRects(
			cvarNum(cvars, 'cl_crosshairsize', 5),
			cvarNum(cvars, 'cl_crosshairgap', 1) + spreadPx,
			cvarNum(cvars, 'cl_crosshairthickness', 1),
			cvarNum(cvars, 'cl_crosshairdot', 0) !== 0
		)
	);
	const color = $derived(
		`rgb(${cvarNum(cvars, 'cl_crosshaircolor_r', 0)}, ${cvarNum(cvars, 'cl_crosshaircolor_g', 255)}, ${cvarNum(cvars, 'cl_crosshaircolor_b', 0)})`
	);
</script>

<div class="crosshair" aria-hidden="true" style:opacity={opacity < 1 ? opacity : undefined}>
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
