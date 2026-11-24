<script lang="ts">
	import type { SlotSymbolId } from '@surf/shared';

	/** Original slot symbols (docs/ui.md#casino). */
	let { id }: { id: SlotSymbolId } = $props();
</script>

<svg viewBox="0 0 64 64" aria-hidden="true">
	{#if id === 'wave'}
		<path d="M4 46C10 22 24 10 40 12c12 1 18 10 15 18-3 7-13 7-14 0 0-4 3-6 6-5-5-6-15-3-18 5-3 9 3 14 13 15 7 0 12-1 18-4v13H4Z" fill="#2f9fe0" />
		<path d="M4 46C10 22 24 10 40 12c12 1 18 10 15 18-3 7-13 7-14 0 0-4 3-6 6-5" fill="none" stroke="#d8f3ff" stroke-width="4" stroke-linecap="round" />
		<path d="M10 49c8-3 14 3 22 2s14-3 24-3" fill="none" stroke="#8fd6fb" stroke-width="3" stroke-linecap="round" />
	{:else if id === 'shell'}
		<path d="M32 8C50 8 60 24 58 38 56 48 44 54 32 56 20 54 8 48 6 38 4 24 14 8 32 8Z" fill="#f08a9a" />
		<path d="M32 10v45M32 55 20 13M32 55 44 13M32 55 10 25M32 55 54 25" stroke="#ffd3d8" stroke-width="3" stroke-linecap="round" />
		<path d="M22 55h20l-3 6H25Z" fill="#c95c70" />
	{:else if id === 'palm'}
		<path d="M31 28c5 10 5 20 1 31h-9c6-10 8-20 4-30Z" fill="#9a6a3a" />
		<path d="M30 28C24 16 12 14 4 22c10-2 18 1 26 6Zm0 0C18 24 8 30 8 42c6-9 13-12 22-14Zm0 0C31 15 42 6 54 12c-10 1-17 7-24 16Zm0 0c12-6 26 0 28 12-8-9-17-12-28-12Zm0 0c10 2 17 10 14 22-2-10-6-17-14-22Z" fill="#37b36a" />
		<circle cx="27" cy="31" r="3.5" fill="#5f3d1c" /><circle cx="34" cy="32" r="3.5" fill="#5f3d1c" />
	{:else if id === 'fin'}
		<path d="M10 52C14 28 28 10 54 6 46 18 44 30 48 40c2 5 4 9 6 12Z" fill="#8a6ff0" />
		<path d="M20 48c4-16 13-28 24-35" fill="none" stroke="#d6ccff" stroke-width="4" stroke-linecap="round" />
		<rect x="8" y="52" width="48" height="7" rx="3" fill="#5a41c2" />
	{:else if id === 'board'}
		<g transform="rotate(38 32 32)">
			<path d="M32 2c9 10 11 20 11 31S39 56 32 62C25 56 21 44 21 33S23 12 32 2Z" fill="#f4e9d2" />
			<path d="M32 2c9 10 11 20 11 31S39 56 32 62Z" fill="#ff7a45" />
			<path d="M32 3v58" stroke="#8a3b1c" stroke-width="2" />
			<path d="M22 24h21M21 30h22" stroke="#27b3a8" stroke-width="3" />
		</g>
	{:else if id === 'sun'}
		<g stroke="#ffb62e" stroke-width="5" stroke-linecap="round">
			<path d="M32 4v7M32 53v7M4 32h7M53 32h7M12 12l5 5M47 47l5 5M52 12l-5 5M17 47l-5 5" />
		</g>
		<circle cx="32" cy="32" r="16" fill="#ffd23f" />
		<path d="M25 30q2-3 4 0M35 30q2-3 4 0M25 37q7 6 14 0" fill="none" stroke="#b56a00" stroke-width="2.6" stroke-linecap="round" />
	{:else}
		<path d="M4 30C10 14 54 14 60 30c-8 5-48 5-56 0Z" fill="#3fa6a0" />
		<path d="M4 36c6 24 50 24 56 0-8-5-48-5-56 0Z" fill="#2b7f7b" />
		<path d="M10 30C20 26 44 26 54 30M16 24c8-3 24-3 32 0" fill="none" stroke="#8fe0d8" stroke-width="2" />
		<circle cx="32" cy="35" r="13" fill="#fdf3ff" />
		<circle cx="32" cy="35" r="13" fill="none" stroke="#d9b6ee" stroke-width="2" />
		<circle cx="27" cy="30" r="4" fill="#fff" />
		<path d="M50 8l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#fff3b0" />
	{/if}
</svg>

<style>
	svg {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
