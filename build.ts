import * as esbuild from 'esbuild';
import { readFileSync, mkdirSync, copyFileSync } from 'fs';
import * as path from 'path';
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

// wasm-bindgen --target bundler の .wasm をブラウザで動かすプラグイン。
// top-level await (ESM) を使い、fetch で WASM をコンパイル・インスタンス化する。
const wasmPlugin: Plugin = {
	name: 'wasm-bundler',
	setup(build) {
		build.onResolve({ filter: /\.wasm$/ }, args => ({
			path: path.resolve(args.resolveDir, args.path),
			namespace: 'wasm-module',
		}));

		build.onLoad({ filter: /.*/, namespace: 'wasm-module' }, args => {
			const wasmPath = args.path;
			const wasmDir = path.dirname(wasmPath);
			const wasmFileName = path.basename(wasmPath);
			const bgJsName = wasmFileName.replace(/\.wasm$/, '.js');

			// .wasm.d.ts からエクスポート名を収集（最も信頼性が高い）
			const dtsContent = readFileSync(wasmPath + '.d.ts', 'utf8');
			const exportNames = [...dtsContent.matchAll(/^export const (\w+)/gm)].map(m => m[1]);
			const destructure = exportNames.map(n => `    ${n},`).join('\n');

			// WASM バイナリを出力ディレクトリにコピー
			const outdir = build.initialOptions.outdir ?? 'docs';
			mkdirSync(outdir, { recursive: true });
			copyFileSync(wasmPath, path.join(outdir, wasmFileName));

			// top-level await で WASM を非同期ロード・インスタンス化し、
			// エクスポートをそのまま名前付きエクスポートとして再公開する
			return {
				resolveDir: wasmDir,
				loader: 'js',
				contents: `
import * as bgJs from './${bgJsName}';
const _res = await fetch(new URL('./${wasmFileName}', import.meta.url));
const _mod = await WebAssembly.compileStreaming(_res);
const _importNames = [...new Set(WebAssembly.Module.imports(_mod).map(i => i.module))];
const _importObj = Object.fromEntries(_importNames.map(name => [name, bgJs]));
const { instance: _inst } = await WebAssembly.instantiate(_mod, _importObj);
export const {
${destructure}
} = _inst.exports;
`,
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
};

// メインアプリ（ESM 形式: top-level await + WASM モジュールをサポート）
const appCtx = await esbuild.context({
	...commonOptions,
	entryPoints: ['src/main.tsx'],
	outfile: 'docs/app.js',
	format: 'esm',
	plugins: [wasmPlugin, cssPlugin],
});

// Service Worker（DOM なし・別バンドル・IIFE 形式）
const swCtx = await esbuild.context({
	...commonOptions,
	entryPoints: ['src/serviceWorker.ts'],
	outfile: 'docs/sw.js',
	format: 'iife',
	define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
	plugins: [cssPlugin],
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
