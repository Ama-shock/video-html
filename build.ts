import * as esbuild from 'esbuild';
import { readFileSync, mkdirSync } from 'fs';
import type { Plugin, BuildOptions } from 'esbuild';

const watch = process.argv.includes('--watch');

// CSS を JS に変換するプラグイン（style タグをインジェクト）
const cssPlugin: Plugin = {
	name: 'css-bundle',
	setup(build) {
		build.onLoad({ filter: /\.css$/ }, (args) => {
			const css = readFileSync(args.path, 'utf8');
			return {
				contents: `
const style = document.createElement('style');
style.textContent = ${JSON.stringify(css)};
document.head.appendChild(style);
`,
				loader: 'js',
			};
		});
	},
};

// 成果物の出力先を確保
mkdirSync('docs', { recursive: true });

const commonOptions: BuildOptions = {
	bundle: true,
	minify: !watch,
	sourcemap: watch ? 'inline' : false,
	target: ['chrome120', 'firefox120', 'safari17'],
	plugins: [cssPlugin],
};

// メインアプリ
const appCtx = await esbuild.context({
	...commonOptions,
	entryPoints: ['src/main.tsx'],
	outfile: 'docs/app.js',
	format: 'iife',
});

// Service Worker（DOM なし・別バンドル）
const swCtx = await esbuild.context({
	...commonOptions,
	entryPoints: ['src/serviceWorker.ts'],
	outfile: 'docs/sw.js',
	format: 'iife',
	define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
});

if (watch) {
	await Promise.all([appCtx.watch(), swCtx.watch()]);
	console.log('[build] Watching for changes...');
} else {
	await Promise.all([appCtx.rebuild(), swCtx.rebuild()]);
	appCtx.dispose();
	swCtx.dispose();
	console.log('[build] Done.');
}
