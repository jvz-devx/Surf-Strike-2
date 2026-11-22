<script lang="ts">
	let {
		pos,
		speed
	}: {
		pos: { x: number; y: number; z: number; pitch: number; yaw: number; vx: number; vy: number; vz: number };
		speed: number;
	} = $props();

	const f = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');
</script>

<div class="pos ss-num ss-shadow">
	<div><span>pos</span> {f(pos.x)} {f(pos.y)} {f(pos.z)}</div>
	<div><span>ang</span> {f(pos.pitch)} {f(pos.yaw)}</div>
	<div><span>vel</span> {f(pos.vx)} {f(pos.vy)} {f(pos.vz)}</div>
	<div><span>spd</span> {f(speed)}</div>
</div>

<style>
	.pos {
		font-size: 14px;
		font-weight: 600;
		line-height: 1.25;
		white-space: pre;
	}
	span {
		display: inline-block;
		width: 2.4em;
		color: var(--text-dim);
		text-transform: uppercase;
		font-size: 0.85em;
	}
</style>
