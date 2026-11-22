<script lang="ts">
	import { PASSWORD_MAX, passwordError, USERNAME_MAX, usernameError } from '@surf/shared';
	import type { GameApi } from '#lib/game/contract.js';
	import { cleanName } from '#lib/ui/format.js';

	let {
		api,
		online,
		connecting = false,
		error = null,
		busy = false,
		guestName = ''
	}: {
		api: GameApi;
		online: boolean;
		connecting?: boolean;
		error?: string | null;
		busy?: boolean;
		guestName?: string;
	} = $props();

	type Tab = 'login' | 'register' | 'guest';
	let tab = $state<Tab>('login');
	let username = $state('');
	let password = $state('');
	let guest = $state('');
	let touched = $state(false);
	let first: HTMLInputElement | undefined = $state();
	let prefilled = false;

	// Prefill the guest name once (the default "Player" counts as no name).
	$effect(() => {
		if (prefilled || !guestName) return;
		prefilled = true;
		if (guestName !== 'Player') guest = guestName;
	});

	$effect(() => {
		void tab;
		first?.focus();
	});

	// Inline validation mirrors the server rules (shared helpers).
	const userProblem = $derived(tab === 'register' && username ? usernameError(username) : null);
	const passProblem = $derived(tab === 'register' && (password || touched) ? passwordError(password) : null);
	const canSubmit = $derived(
		online &&
			!busy &&
			username.length > 0 &&
			password.length > 0 &&
			(tab === 'login' || (!usernameError(username) && !passwordError(password)))
	);
	const cleanGuest = $derived(cleanName(guest));

	function pick(t: Tab) {
		tab = t;
		touched = false;
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		touched = true;
		if (tab === 'guest') {
			if (cleanGuest) api.playAsGuest(cleanGuest);
			return;
		}
		if (!canSubmit) return;
		if (tab === 'login') api.login(username, password);
		else api.register(username, password);
	}

	function keydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') {
			e.preventDefault();
			api.closeAuth();
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop ss-overlay" onkeydown={keydown}>
	<form class="panel ss-panel" onsubmit={submit} aria-labelledby="ss-auth-title" novalidate>
		<div class="head">
			<div class="brand">Surf Strike 2</div>
			<button type="button" class="close" aria-label="Close" onclick={() => api.closeAuth()}>×</button>
		</div>
		<h2 id="ss-auth-title" class="title">
			{tab === 'login' ? 'Log in' : tab === 'register' ? 'Create account' : 'Play as guest'}
		</h2>

		<div class="tabs" role="tablist">
			<button type="button" role="tab" aria-selected={tab === 'login'} class:on={tab === 'login'} onclick={() => pick('login')}
				>Login</button
			>
			<button
				type="button"
				role="tab"
				aria-selected={tab === 'register'}
				class:on={tab === 'register'}
				onclick={() => pick('register')}>Register</button
			>
		</div>

		{#if tab !== 'guest'}
			{#if !online}
				<p class="note">
					{connecting ? 'Connecting to the server…' : 'Server offline — play as guest; log in when online.'}
				</p>
			{/if}
			<label class="field">
				<span>Username</span>
				<input
					class="ss-input"
					bind:this={first}
					bind:value={username}
					maxlength={USERNAME_MAX}
					autocomplete="username"
					autocapitalize="off"
					spellcheck="false"
					aria-invalid={userProblem ? 'true' : undefined}
				/>
				{#if userProblem}<span class="bad">{userProblem}</span>{/if}
			</label>
			<label class="field">
				<span>Password</span>
				<input
					class="ss-input"
					type="password"
					bind:value={password}
					maxlength={PASSWORD_MAX}
					autocomplete={tab === 'login' ? 'current-password' : 'new-password'}
					aria-invalid={passProblem ? 'true' : undefined}
				/>
				{#if passProblem}<span class="bad">{passProblem}</span>
				{:else if tab === 'register'}<span class="hint">No spaces in the username; password at least 5 characters.</span>{/if}
			</label>
			{#if error}<p class="bad" role="alert">{error}</p>{/if}
			<button class="ss-button" type="submit" disabled={!canSubmit}>
				{busy ? 'Please wait…' : tab === 'login' ? 'Log in' : 'Register'}
			</button>
			<p class="hint">Only accounts appear on the leaderboard.</p>
			<button type="button" class="link" onclick={() => pick('guest')}>Play as guest</button>
		{:else}
			<label class="field">
				<span>Name</span>
				<input
					class="ss-input"
					bind:this={first}
					bind:value={guest}
					maxlength="24"
					autocomplete="nickname"
					spellcheck="false"
				/>
			</label>
			<p class="hint">Guests can play everything, but runs are not saved to the leaderboard.</p>
			<button class="ss-button" type="submit" disabled={!cleanGuest}>Play</button>
			<button type="button" class="link" onclick={() => pick('login')}>Log in or register instead</button>
		{/if}
	</form>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(0, 0, 0, 0.4);
		pointer-events: auto;
	}
	.panel {
		width: 320px;
		max-width: calc(100vw - 32px);
		padding: 18px 20px 20px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		background: var(--panel-bg-strong);
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.brand {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.close {
		font: 400 20px/1 var(--ui-font);
		color: var(--text-dim);
		background: none;
		border: none;
		padding: 0 2px;
		cursor: pointer;
	}
	.close:hover {
		color: var(--text);
	}
	.title {
		margin: 0;
		font-size: 22px;
		font-weight: 600;
	}
	.tabs {
		display: flex;
		gap: 2px;
		border-bottom: 1px solid var(--panel-border);
	}
	.tabs button {
		flex: 1;
		font: 600 13px/1 var(--ui-font);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-dim);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		padding: 8px 0;
		cursor: pointer;
	}
	.tabs button.on {
		color: var(--text);
		border-bottom-color: var(--accent);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.field > span:first-child {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-dim);
	}
	input {
		font-size: 17px;
	}
	input[aria-invalid='true'] {
		border-color: var(--bad);
	}
	.note {
		margin: 0;
		padding: 7px 9px;
		font-size: 13px;
		color: var(--system);
		background: rgba(242, 196, 90, 0.08);
		border: 1px solid rgba(242, 196, 90, 0.3);
		border-radius: var(--radius);
	}
	.bad {
		margin: 0;
		font-size: 13px;
		color: var(--bad);
	}
	.hint {
		margin: 0;
		font-size: 12px;
		color: var(--text-faint);
	}
	.link {
		align-self: center;
		font: 500 13px/1.2 var(--ui-font);
		color: var(--info);
		background: none;
		border: none;
		padding: 2px;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
