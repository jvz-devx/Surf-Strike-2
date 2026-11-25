/** Hide and seek on the client (docs/modes.md#hide-and-seek): `HnsClient` as a `ClientMode`. */
import { HNS_NAMETAG_RANGE, Status, type Cvars, type GameModeId, type NetState, type ScoreRow, type Vec3 } from '@surf/shared';
import type { RemotePlayers } from '../../render/players.js';
import { HnsClient, type HnsHost } from '../hns.js';
import { hnsTagVisible } from '../hns-view.js';
import type { ClientMode, ClientModeHost, ModeServerMessage, RemotePlayer } from './types.js';

const ZERO_VEC: Vec3 = { x: 0, y: 0, z: 0 };

export class HnsMode implements ClientMode {
	readonly id: GameModeId = 'hns';
	readonly client: HnsClient;
	/** I seek, or did before I went to spectate: the server takes spectators out of the round, but they come back as seekers. */
	private seekerThisRound = false;

	constructor(private readonly host: ClientModeHost) {
		this.client = new HnsClient(clientHost(host), host.map);
		host.hud.hns = this.client.frame(performance.now(), false, 0);
	}

	press(action: 'attack' | 'attack2', down: boolean, now: number): void {
		const { host } = this;
		if (action === 'attack') this.client.press(down, now, host.eye, host.pitch, host.yaw);
	}

	restart(): void {
		if (!this.client.canRespawn()) return this.host.notice("You can't respawn during a hide and seek round.");
		this.respawn();
	}

	/** Also during a round (spectating ended). */
	respawn(): void {
		this.host.teleport(this.client.fallSpawn());
	}

	/** Seekers are frozen while the hiders hide, and found hiders for a moment. */
	moveCvars(end: number): Cvars | null {
		if (!this.client.frozen(end)) return this.host.sv;
		const v = this.host.player.velocity;
		v.x = v.y = 0;
		if (v.z > 0) v.z = 0;
		return null;
	}

	tick(): void {
		this.host.teleportZones(() => this.client.fallSpawn());
	}

	netState(s: NetState): void {
		s.status = this.client.role === 'seeker' ? Status.Seeker : Status.Hider;
		s.stage = 0;
		s.runTicks = 0;
	}

	frame(now: number): void {
		const { hud, player, spec } = this.host;
		const v = this.client.frame(now, !spec, Math.hypot(player.velocity.x, player.velocity.y));
		if (hud.hns !== v) hud.hns = v;
	}

	/**
	 * Seekers are marked and hold the knife; tags only up close, in sight, never
	 * hider tags to seekers, to who sought this round or to who watches a seeker.
	 */
	dress(players: RemotePlayers, p: RemotePlayer, visible: boolean): void {
		const { client, host } = this;
		const role = client.roleOf(p.id);
		players.setHeld(p.id, role === 'seeker' ? 'knife' : null);
		players.setSeeker(p.id, role === 'seeker');
		if (!visible) return;
		const eye = host.spec ? host.spec.pos : host.eye;
		const head = { x: p.sample.x, y: p.sample.y, z: p.sample.z + 64 };
		const dist = Math.hypot(head.x - eye.x, head.y - eye.y, head.z - eye.z);
		const los = dist <= HNS_NAMETAG_RANGE && host.world.trace(eye, head, ZERO_VEC, ZERO_VEC).fraction >= 1;
		const viewer = this.seekerThisRound ? 'seeker' : client.roleOf(host.viewId);
		players.setTagVisible(p.id, hnsTagVisible(viewer, role, dist, los));
	}

	soloRow(): Partial<ScoreRow> {
		return { status: Status.Hider, kills: 0, score: 0, it: undefined };
	}

	message(m: ModeServerMessage, now: number): void {
		if (m.type === 'modeState' && m.mode === 'hns') {
			this.client.onModeState(m, now);
			const role = this.client.roleOf(this.host.selfId);
			if (role || (m.phase !== 'hiding' && m.phase !== 'seeking')) this.seekerThisRound = role === 'seeker';
		} else if (m.type === 'hns') {
			this.client.onEvent(m.ev, now);
			if (m.ev.e === 'swing') this.host.avatarAct(m.ev.by, 'swing');
		}
	}

	dispose(): void {
		this.client.dispose();
		this.host.hud.hns = null;
	}
}

function clientHost(host: ClientModeHost): HnsHost {
	return {
		online: () => host.online,
		selfId: () => host.selfId,
		send: (msg) => host.send(msg),
		name: (id) => host.name(id),
		teleport: (pos, yaw) => host.teleport({ pos, yaw }),
		sound: (name, from) => {
			if (from === undefined || from === host.selfId) return host.audio.hns(name);
			const r = host.remotes.get(from);
			if (!r?.hasSample) return;
			const o = host.player.origin;
			host.audio.hns(name, Math.hypot(r.sample.x - o.x, r.sample.y - o.y, r.sample.z - o.z));
		},
		viewmodel: () => host.renderer?.zombies ?? null,
		viewId: () => host.viewId,
		cashBag: () => host.renderer?.cashBag ?? null,
		eye: () => {
			const pos = host.spec ? host.spec.pos : host.eye;
			return { x: pos.x, y: pos.y, yaw: host.yaw };
		}
	};
}
