/**
 * Dev-only HUD mock (used with `?mockhud`). Builds a reactive HudStateShape
 * with sample data and a GameApi that only flips UI flags, so the UI can be
 * previewed without the engine. Optional `&open=console|settings|maps|auth|scoreboard|chat|desktop`;
 * with `open=settings`, `&view=maps|settings|account` and `&tab=mouse|video|hud|audio`
 * start the Esc menu on a submenu (`&solo=0` makes map changes vote-only; `&view=admin`
 * logs in as an admin and opens the Admin submenu, `&tab=maps|players|bans`; `&rtv=1` shows
 * an RTV request instead of the map vote, `&rtv=cooldown` a declined-request cooldown).
 */
import { Status, TICK_RATE } from '@surf/shared';
import type { GameApi, GameHandle, HudStateShape } from '#lib/game/contract.js';

const T = TICK_RATE;

export function createMockGame(canvas: HTMLCanvasElement, open: string | null): GameHandle {
	const t0 = performance.now();
	const params = new URLSearchParams(location.search);
	const asAdmin = params.get('view') === 'admin' || params.has('admin');
	const hud: HudStateShape = $state({
		online: true,
		connecting: false,
		playerCount: 12,
		maxPlayers: 32,
		mapId: 'surf_ember',
		mapTitle: 'Ember',
		mapTimeLeft: 462,
		gameMode: 'surf',
		modeFamily: 'race',
		tag: null,
		zombies: null,
		infected: null,
		hns: null,
		maps: [
			{ id: 'surf_aurora', title: 'Aurora', kind: 'surf', difficulty: 'easy' },
			{ id: 'surf_ember', title: 'Ember', kind: 'surf', difficulty: 'hard' },
			{ id: 'bhop_meadow', title: 'Meadow', kind: 'bhop', difficulty: 'easy' },
			{ id: 'surf_tidal', title: 'Tidal', kind: 'surf', difficulty: 'easy' },
			{ id: 'bhop_quarry', title: 'Quarry', kind: 'bhop', difficulty: 'hard' },
			{ id: 'tag_courtyard', title: 'Courtyard', kind: 'tag', difficulty: 'easy', disabled: true }
		],
		canChangeMap: params.get('solo') !== '0',
		speed: 1287,
		speedTrend: 'up',
		keys: { w: false, a: true, s: false, d: false, jump: true, duck: false },
		runPhase: 'running',
		runTicks: Math.round(72.402 * T),
		stage: 3,
		stageCount: 6,
		stageKind: 'stage',
		unofficial: false,
		splitPopup: { label: 'Stage 3', ticks: Math.round(72.402 * T), delta: Math.round(-0.213 * T), at: t0 },
		pbTicks: Math.round(151.337 * T),
		pbRank: 4,
		recordTicks: Math.round(138.902 * T),
		recordName: 'glidepath',
		account: open === 'auth' ? null : asAdmin ? { username: 'Tim', admin: true } : { username: 'you' },
		adminState: asAdmin
			? {
					maps: [
						{ id: 'surf_aurora', title: 'Aurora', kind: 'surf', enabled: true },
						{ id: 'surf_ember', title: 'Ember', kind: 'surf', enabled: true },
						{ id: 'surf_tidal', title: 'Tidal', kind: 'surf', enabled: true },
						{ id: 'bhop_meadow', title: 'Meadow', kind: 'bhop', enabled: true },
						{ id: 'bhop_quarry', title: 'Quarry', kind: 'bhop', enabled: true },
						{ id: 'tag_courtyard', title: 'Courtyard', kind: 'tag', enabled: false }
					],
					bans: [
						{ id: 1, username: 'griefer42', kind: 'guest', reason: 'spam', createdAt: Date.now() - 86_400_000, createdBy: 'Tim' },
						{ id: 2, username: 'Smurf', kind: 'account', reason: null, createdAt: Date.now() - 3_600_000, createdBy: 'Tim' }
					],
					players: [
						{ id: 2, name: 'Tim', account: 'Tim', guest: false, admin: true },
						{ id: 1, name: 'glidepath', account: 'glidepath', guest: false, admin: false },
						{ id: 3, name: 'cirrus', guest: true, admin: false },
						{ id: 4, name: 'boreal', account: 'boreal', guest: false, admin: false }
					]
				}
			: null,
		adminNotice: null,
		authError: null,
		authBusy: false,
		chat: [
			{ id: 1, from: null, text: 'cirrus joined the game', system: true, at: t0 },
			{ id: 2, from: 'cirrus', text: 'gl hf', system: false, at: t0 },
			{ id: 3, from: 'glidepath', text: 'stage 4 ramp is tricky <b>not bold</b>', system: false, at: t0 },
			{ id: 4, from: null, text: 'New map record by glidepath: 02:18.902', system: true, at: t0 }
		],
		chatOpen: open === 'chat',
		vote: params.has('rtv')
			? null
			: {
					labels: [
						'Surf · Tidal',
						'Surf · Aurora',
						'Bhop · Meadow',
						'Bhop · Quarry',
						'Tag · Courtyard',
						'Zombie Run · Foundry',
						'Extend 10 min'
					],
					counts: [3, 5, 1, 0, 2, 1, 2],
					endsAt: t0 + 14000,
					duration: 20,
					myVote: 2,
					rtv: false,
					result: null
				},
		rtvRequest:
			params.get('rtv') === '1'
				? {
						initiator: 'glidepath',
						mapLabel: 'Bhop · Meadow',
						yes: 2,
						no: 1,
						needed: 4,
						endsAt: t0 + 14000,
						duration: 20,
						myChoice: null,
						canVote: true,
						result: null
					}
				: null,
		rtvCooldown: params.get('rtv') === 'cooldown' ? { until: t0 + 45_000, reason: 'declined' } : null,
		scoreboardOpen: open === 'scoreboard',
		scoreboard: [
			{ id: 1, name: 'glidepath', rank: 1, pbTicks: Math.round(138.902 * T), status: Status.Running, stage: 5, ping: 24, spectating: false },
			{ id: 2, name: 'you', rank: 4, pbTicks: Math.round(151.337 * T), status: Status.Running, stage: 3, ping: 31, spectating: false },
			{ id: 3, name: 'cirrus', rank: null, pbTicks: null, status: Status.StartZone, stage: 0, ping: 58, spectating: false },
			{ id: 4, name: 'boreal', rank: 2, pbTicks: Math.round(142.1 * T), status: Status.Finished, stage: 6, ping: 77, spectating: false },
			{ id: 5, name: 'lurker', rank: 9, pbTicks: Math.round(190 * T), status: Status.Spectating, stage: 0, ping: 40, spectating: true }
		],
		spectating: null,
		consoleOpen: open === 'console',
		consoleLines: [
			{ id: 1, text: 'Surf Strike 2 console. Type "help".', kind: 'output' },
			{ id: 2, text: 'sensitivity 2.5', kind: 'input' },
			{ id: 3, text: '"sensitivity" = "2.5"', kind: 'echo' },
			{ id: 4, text: 'Unknown command: foo', kind: 'error' }
		],
		settingsOpen: open === 'settings' || open === 'maps',
		authPanelOpen: open === 'auth' || open === 'name',
		pointerLocked: false,
		fullscreenSupported: true,
		desktopOnly: open === 'desktop',
		fps: 144,
		pos: { x: 1024.5, y: -332.25, z: 512, pitch: 4.2, yaw: 91.3, vx: 1200, vy: -460, vz: -88 },
		cvars: {
			sensitivity: 2.5,
			m_yaw: 0.022,
			m_pitch: 0.022,
			fov: 90,
			volume: 0.5,
			cl_showfps: 1,
			cl_showkeys: 1,
			cl_showpos: 0,
			cl_crosshairsize: 5,
			cl_crosshairgap: 1,
			cl_crosshairthickness: 1,
			cl_crosshaircolor_r: 0,
			cl_crosshaircolor_g: 255,
			cl_crosshaircolor_b: 0,
			cl_crosshairdot: 0,
			cl_ghost: 1,
			cl_hideplayers: 0
		}
	});

	const names = ['sensitivity', 'fov', 'volume', 'cl_showfps', 'cl_showkeys', 'cl_showpos', 'cl_crosshairsize', 'connect', 'cvarlist', 'clear'];
	const hist: string[] = [];
	let nextId = 100;

	const api: GameApi = {
		exec(line) {
			hist.push(line);
			hud.consoleLines.push({ id: nextId++, text: line, kind: 'input' });
			const [name, value] = line.split(/\s+/);
			if (name === 'clear') hud.consoleLines = [];
			else if (name in hud.cvars && value !== undefined) api.setCvar(name, Number.isFinite(+value) ? +value : value);
			else hud.consoleLines.push({ id: nextId++, text: `Unknown command: ${name}`, kind: 'error' });
		},
		complete: (prefix) => names.filter((n) => n.startsWith(prefix)),
		history: () => hist.slice(),
		sendChat(text) {
			hud.chat.push({ id: nextId++, from: 'you', text, system: false, at: performance.now() });
		},
		setCvar(name, value) {
			hud.cvars[name] = value;
		},
		login(username) {
			hud.account = { username };
			hud.authPanelOpen = false;
		},
		register(username) {
			hud.account = { username };
			hud.authPanelOpen = false;
		},
		logout() {
			hud.account = null;
		},
		playAsGuest(name) {
			hud.cvars.name = name;
			hud.authPanelOpen = false;
		},
		openAuth() {
			hud.settingsOpen = false;
			hud.authPanelOpen = true;
		},
		closeAuth() {
			hud.authPanelOpen = false;
		},
		lockPointer() {
			hud.pointerLocked = true;
		},
		openChat: () => (hud.chatOpen = true),
		closeChat: () => (hud.chatOpen = false),
		toggleConsole: () => (hud.consoleOpen = !hud.consoleOpen),
		closeSettings: () => (hud.settingsOpen = false),
		vote(option) {
			if (hud.vote) hud.vote.myVote = option;
		},
		rtvVote(yes) {
			const r = hud.rtvRequest;
			if (!r || r.myChoice === (yes ? 'yes' : 'no')) return;
			hud.rtvRequest = {
				...r,
				myChoice: yes ? 'yes' : 'no',
				yes: r.yes + (yes ? 1 : 0) - (r.myChoice === 'yes' ? 1 : 0),
				no: r.no + (yes ? 0 : 1) - (r.myChoice === 'no' ? 1 : 0)
			};
		},
		admin(a) {
			const st = hud.adminState;
			if (!st) return;
			const done = (text: string) => (hud.adminNotice = { ok: true, text, at: performance.now() });
			if (a.action === 'setMapEnabled') {
				if (!a.enabled && st.maps.filter((m) => m.enabled).length <= 1) {
					hud.adminNotice = { ok: false, text: 'At least one map must stay enabled.', at: performance.now() };
					hud.adminState = { ...st };
					return;
				}
				hud.adminState = { ...st, maps: st.maps.map((m) => (m.id === a.mapId ? { ...m, enabled: a.enabled } : m)) };
				hud.maps = hud.maps.map((m) => (m.id === a.mapId ? { ...m, disabled: !a.enabled } : m));
				done(`${a.mapId} ${a.enabled ? 'enabled' : 'disabled'}.`);
			} else if (a.action === 'ban') {
				const p = st.players.find((x) => x.id === a.targetId);
				const name = p?.name ?? a.username ?? '?';
				hud.adminState = {
					...st,
					players: st.players.filter((x) => x !== p),
					bans: [
						{ id: Date.now(), username: name, kind: p?.guest ? 'guest' : 'account', reason: a.reason ?? null, createdAt: Date.now(), createdBy: 'Tim' },
						...st.bans
					]
				};
				done(`Banned ${name}.`);
			} else if (a.action === 'unban') {
				hud.adminState = { ...st, bans: st.bans.filter((b) => b.id !== a.banId) };
				done('Unbanned.');
			} else if (a.action === 'forceMap') {
				api.changeMap(a.mapId);
				done(`Changed to ${a.mapId}.`);
			} else if (a.action === 'extend') {
				done('Extended by 10 minutes.');
			}
		},
		changeMap(id) {
			const m = hud.maps.find((x) => x.id === id);
			if (m) {
				hud.mapId = m.id;
				hud.mapTitle = m.title;
			}
		}
	};

	const overlay = () => hud.chatOpen || hud.consoleOpen || hud.settingsOpen || hud.authPanelOpen;
	const down = (e: KeyboardEvent) => {
		if (e.key === '`' && !hud.chatOpen) {
			e.preventDefault();
			api.toggleConsole();
			return;
		}
		if (overlay()) return;
		if (e.key === 'Tab') {
			e.preventDefault();
			hud.scoreboardOpen = true;
		} else if (e.key === 'y') {
			e.preventDefault();
			api.openChat();
		} else if (e.key === 'Escape') {
			hud.pointerLocked = false;
			hud.settingsOpen = true;
		} else if (e.key === 'm') {
			hud.spectating = hud.spectating ? null : { targetName: 'glidepath', freeFly: false };
		} else if (e.key === 'r') {
			hud.splitPopup = { label: 'Stage 4', ticks: hud.runTicks, delta: Math.round(0.42 * T), at: performance.now() };
		} else if (hud.rtvRequest && (e.key === '1' || e.key === '2')) api.rtvVote(e.key === '1');
		else if (e.key >= '1' && e.key <= '7') api.vote(Number(e.key));
	};
	const up = (e: KeyboardEvent) => {
		if (e.key === 'Tab') hud.scoreboardOpen = false;
	};
	window.addEventListener('keydown', down);
	window.addEventListener('keyup', up);

	const ctx = canvas.getContext('2d');
	let raf = 0;
	const frame = () => {
		const t = (performance.now() - t0) / 1000;
		const s = 1200 + Math.sin(t * 0.8) * 300;
		hud.speedTrend = s > hud.speed + 0.5 ? 'up' : s < hud.speed - 0.5 ? 'down' : 'flat';
		hud.speed = s;
		hud.runTicks = Math.round((72.402 + t) * T);
		hud.mapTimeLeft = Math.max(0, 462 - t);
		if (ctx) {
			const { width: w, height: h } = canvas;
			const g = ctx.createLinearGradient(0, 0, 0, h);
			g.addColorStop(0, '#9fd3ff');
			g.addColorStop(0.55, '#f4f7fb');
			g.addColorStop(0.56, '#5a6470');
			g.addColorStop(1, '#2a2f36');
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, w, h);
		}
		raf = requestAnimationFrame(frame);
	};
	const resize = () => {
		canvas.width = canvas.clientWidth;
		canvas.height = canvas.clientHeight;
	};
	resize();
	window.addEventListener('resize', resize);
	raf = requestAnimationFrame(frame);

	return {
		hud,
		api,
		destroy() {
			cancelAnimationFrame(raf);
			window.removeEventListener('keydown', down);
			window.removeEventListener('keyup', up);
			window.removeEventListener('resize', resize);
		}
	};
}
