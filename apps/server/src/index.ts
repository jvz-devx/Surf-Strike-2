/** Game server only (no tunnel): `pnpm --filter server start` / `dev`. */
import { loadDotEnv, startServer } from './server.ts';

loadDotEnv();

try {
	const server = await startServer();
	console.log(`game server on http://localhost:${server.port} (ws: /ws), map ${server.lobby.currentMap.id}`);
	const stop = () => {
		void server.close().then(() => process.exit(0));
	};
	process.once('SIGINT', stop);
	process.once('SIGTERM', stop);
} catch (err) {
	console.error(`failed to start: ${(err as Error).message}`);
	process.exit(1);
}
