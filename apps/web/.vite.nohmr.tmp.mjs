import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-vercel';
export default {
	root: '/home/tim/Desktop/Surf-Strike 2/apps/web',
	plugins: [sveltekit({ compilerOptions: { runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true) }, adapter: adapter() })],
	server: { hmr: false, watch: { ignored: ['**/*'] } }
};
