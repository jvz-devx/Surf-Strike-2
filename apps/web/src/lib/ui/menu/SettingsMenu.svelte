<script lang="ts">
	import type { GameApi } from '#lib/game/contract.js';
	import { cvarNum, hexToRgb, rgbToHex } from '#lib/ui/format.js';
	import Crosshair from '#lib/ui/Crosshair.svelte';
	import Slider from '#lib/ui/menu/Slider.svelte';
	import Toggle from '#lib/ui/menu/Toggle.svelte';
	import Tabs from '#lib/ui/menu/Tabs.svelte';
	import {
		clampCvar,
		cvarDefault,
		SETTINGS_SECTIONS,
		sectionDefaults,
		sectionIsDefault,
		type SettingsSectionId
	} from '#lib/ui/menu/menu.js';

	let {
		cvars,
		api,
		fullscreenSupported = false,
		section = $bindable('mouse')
	}: {
		cvars: Record<string, number | string>;
		api: GameApi;
		/** Fullscreen can block Ctrl+W here (Keyboard Lock API, Chromium). */
		fullscreenSupported?: boolean;
		section?: SettingsSectionId;
	} = $props();

	const n = (name: string) => cvarNum(cvars, name, cvarDefault(name));
	const on = (name: string) => n(name) !== 0;
	const set = (name: string) => (v: number) => api.setCvar(name, clampCvar(name, v));
	const flag = (name: string) => (v: boolean) => api.setCvar(name, v ? 1 : 0);

	const chColor = $derived(rgbToHex(n('cl_crosshaircolor_r'), n('cl_crosshaircolor_g'), n('cl_crosshaircolor_b')));
	const current = $derived(SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0]);
	const isDefault = $derived(sectionIsDefault(cvars, current.id));

	function color(e: Event) {
		const rgb = hexToRgb((e.currentTarget as HTMLInputElement).value);
		if (!rgb) return;
		api.setCvar('cl_crosshaircolor_r', rgb[0]);
		api.setCvar('cl_crosshaircolor_g', rgb[1]);
		api.setCvar('cl_crosshaircolor_b', rgb[2]);
	}

	function reset() {
		for (const [name, value] of sectionDefaults(current.id)) api.setCvar(name, value);
	}

	const fixed = (digits: number) => (v: number) => v.toFixed(digits);
</script>

<header class="head">
	<h2 id="ss-menu-title">Settings</h2>
</header>

<Tabs
	tabs={SETTINGS_SECTIONS.map((s) => ({ id: s.id, label: s.label }))}
	selected={section}
	onselect={(id) => (section = id as SettingsSectionId)}
	label="Settings sections"
	idPrefix="ss-settings"
/>

<div class="body" id="ss-settings-panel" role="tabpanel" aria-labelledby="ss-settings-tab-{section}">
	{#if section === 'mouse'}
		<Slider
			id="ss-sens"
			label="Sensitivity"
			value={n('sensitivity')}
			min={0.1}
			max={10}
			step={0.05}
			numberField
			numMin={0.01}
			numMax={100}
			numStep={0.01}
			onset={set('sensitivity')}
		/>
		<div class="sub ss-label">Advanced</div>
		<Slider
			id="ss-myaw"
			label="m_yaw"
			value={n('m_yaw')}
			min={0.005}
			max={0.05}
			step={0.001}
			numberField
			numMin={-1}
			numMax={1}
			numStep={0.001}
			onset={set('m_yaw')}
		/>
		<Slider
			id="ss-mpitch"
			label="m_pitch"
			value={n('m_pitch')}
			min={0.005}
			max={0.05}
			step={0.001}
			numberField
			numMin={-1}
			numMax={1}
			numStep={0.001}
			onset={set('m_pitch')}
		/>
		<p class="note">Degrees per mouse count. Negative m_pitch inverts the mouse.</p>
	{:else if section === 'video'}
		<Slider
			id="ss-fov"
			label="Field of view"
			value={n('fov')}
			min={60}
			max={130}
			step={1}
			format={(v) => `${Math.round(v)}°`}
			onset={set('fov')}
		/>
		<p class="note">Horizontal FOV at 4:3, scaled for widescreen as in CS.</p>
		{#if fullscreenSupported}
			<Toggle
				label="Fullscreen (blocks Ctrl+W)"
				hint="Starts when you click to play; hold Esc to leave"
				checked={on('cl_fullscreen')}
				onset={flag('cl_fullscreen')}
			/>
		{:else}
			<p class="note">This browser cannot block Ctrl+W; it asks before closing while you play.</p>
		{/if}
		<Toggle label="Show FPS" checked={on('cl_showfps')} onset={flag('cl_showfps')} />
		<Toggle
			label="Show position"
			hint="Position, angles and velocity readout"
			checked={on('cl_showpos')}
			onset={flag('cl_showpos')}
		/>
	{:else if section === 'hud'}
		<div class="crosshair-block">
			<div class="preview" role="img" aria-label="Crosshair preview">
				<Crosshair {cvars} />
			</div>
			<div class="ch-ctl">
				<div class="color-row">
					<label for="ss-chcolor">Crosshair colour</label>
					<input id="ss-chcolor" type="color" class="swatch" value={chColor} oninput={color} />
				</div>
				<Slider
					id="ss-chsize"
					label="Size"
					value={n('cl_crosshairsize')}
					min={0}
					max={20}
					step={0.5}
					format={fixed(1)}
					onset={set('cl_crosshairsize')}
				/>
				<Slider
					id="ss-chgap"
					label="Gap"
					value={n('cl_crosshairgap')}
					min={-5}
					max={20}
					step={0.5}
					format={fixed(1)}
					onset={set('cl_crosshairgap')}
				/>
				<Slider
					id="ss-chthick"
					label="Thickness"
					value={n('cl_crosshairthickness')}
					min={0.5}
					max={10}
					step={0.5}
					format={fixed(1)}
					onset={set('cl_crosshairthickness')}
				/>
				<Toggle label="Centre dot" checked={on('cl_crosshairdot')} onset={flag('cl_crosshairdot')} />
			</div>
		</div>
		<div class="sub ss-label">Display</div>
		<Toggle label="Show keys" hint="Pressed keys under the crosshair" checked={on('cl_showkeys')} onset={flag('cl_showkeys')} />
		<Toggle label="Show ghost" hint="Race ghost on surf and bhop maps" checked={on('cl_ghost')} onset={flag('cl_ghost')} />
		<Toggle label="Hide players" hint="Hide other players (not the ghost)" checked={on('cl_hideplayers')} onset={flag('cl_hideplayers')} />
	{:else}
		<Slider
			id="ss-vol"
			label="Master volume"
			value={n('volume')}
			min={0}
			max={1}
			step={0.01}
			format={(v) => `${Math.round(v * 100)}%`}
			onset={set('volume')}
		/>
	{/if}
</div>

<footer class="foot">
	<span class="hint">Same cvars as the console ( ` )</span>
	<button type="button" class="reset" disabled={isDefault} onclick={reset}>Reset {current.label} to defaults</button>
</footer>

<style>
	.head h2 {
		margin: 0;
		font: 700 22px/1 var(--ui-font);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 6px 4px 6px 0;
	}
	.sub {
		margin-top: 12px;
		padding-bottom: 4px;
		border-bottom: 1px solid var(--panel-border);
	}
	.note {
		margin: -2px 0 4px;
		font-size: 12px;
		color: var(--text-faint);
	}
	.crosshair-block {
		display: grid;
		grid-template-columns: 137px 1fr;
		gap: 18px;
		align-items: start;
	}
	.preview {
		position: relative;
		width: 137px; /* odd: 1px lines land on whole pixels */
		height: 137px;
		border: 1px solid var(--panel-border-strong);
		border-radius: var(--radius);
		background:
			linear-gradient(180deg, #8fc5ef 0%, #dde8f2 52%, #5a6470 53%, #2a2f36 100%);
		overflow: hidden;
	}
	.ch-ctl {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.ch-ctl :global(.row) {
		grid-template-columns: 90px 1fr;
	}
	.color-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 34px;
	}
	.color-row label {
		color: var(--text-dim);
		font-size: 15px;
	}
	.swatch {
		width: 76px;
		height: 26px;
		padding: 0 2px;
		background: transparent;
		border: 1px solid var(--panel-border-strong);
		border-radius: 2px;
		cursor: pointer;
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding-top: 12px;
		border-top: 1px solid var(--panel-border);
	}
	.hint {
		font-size: 12px;
		color: var(--text-faint);
	}
	.reset {
		padding: 7px 12px;
		font: 600 12px/1 var(--ui-font);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text);
		background: transparent;
		border: 1px solid var(--panel-border-strong);
		border-radius: var(--radius);
		cursor: pointer;
	}
	.reset:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}
	.reset:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
