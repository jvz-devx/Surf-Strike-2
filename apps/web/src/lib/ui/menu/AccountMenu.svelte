<script lang="ts">
	import type { GameApi } from '#lib/game/contract.js';

	let {
		api,
		account,
		online
	}: { api: GameApi; account: { username: string } | null; online: boolean } = $props();
</script>

<header class="head">
	<h2 id="ss-menu-title">Account</h2>
</header>

<div class="body">
	{#if account}
		<div class="card">
			<span class="ss-label">Logged in as</span>
			<span class="name">{account.username}</span>
			<span class="hint">Your runs are saved to the leaderboard.</span>
		</div>
		<div class="actions">
			<button type="button" class="ss-button ghost" onclick={() => api.logout()}>Log out</button>
		</div>
	{:else}
		<div class="card">
			<span class="ss-label">Playing as guest</span>
			<span class="hint">
				{online ? 'Runs are not saved to the leaderboard.' : 'Offline: log in when the server is online.'}
			</span>
		</div>
		<div class="actions">
			<button type="button" class="ss-button" onclick={() => api.openAuth()}>Log in / Register</button>
		</div>
	{/if}
</div>

<style>
	.head h2 {
		margin: 0;
		font: 700 22px/1 var(--ui-font);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px 16px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--panel-border);
		border-radius: var(--radius);
	}
	.name {
		font-size: 24px;
		font-weight: 700;
		color: var(--accent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hint {
		font-size: 14px;
		color: var(--text-dim);
	}
	.actions {
		display: flex;
		gap: 10px;
	}
	.ghost {
		color: var(--text);
		background: transparent;
		border-color: var(--panel-border-strong);
	}
</style>
