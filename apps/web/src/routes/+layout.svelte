<script lang="ts">
	import '@fontsource/barlow-semi-condensed/400.css';
	import '@fontsource/barlow-semi-condensed/500.css';
	import '@fontsource/barlow-semi-condensed/600.css';
	import '@fontsource/barlow-semi-condensed/700.css';
	import '@fontsource/rajdhani/500.css';
	import '@fontsource/rajdhani/600.css';
	import '@fontsource/rajdhani/700.css';
	import '#lib/ui/theme.css';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

{@render children()}
