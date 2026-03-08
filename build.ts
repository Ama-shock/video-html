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
// wasm-bindgen --target bundler の WASM をブラウザで動かすプラグイン。
// パッケージの sideEffects:false により tree-shake されるため、
// パッケージ import 自体をフックして初期化コードに置き換える。
const wasmPlugin: Plugin = {
	name: 'wasm-bundler',
	setup(build) {
		// @ama-shock/non-resident-vapid の import を丸ごとフック
		build.onResolve({ filter: /^@ama-shock\/non-resident-vapid$/ }, args => ({
			path: args.path,
			namespace: 'nrv-entry',
			sideEffects: true,
		}));

		build.onLoad({ filter: /.*/, namespace: 'nrv-entry' }, () => {
			const pkgDir = path.join('node_modules', '@ama-shock', 'non-resident-vapid', 'pkg');
			const wasmFileName = 'non_resident_vapid_bg.wasm';
			const bgJsName = 'non_resident_vapid_bg.js';
			const wasmPath = path.join(pkgDir, wasmFileName);

			// WASM バイナリを出力ディレクトリにコピー
			const outdir = build.initialOptions.outdir ?? 'public';
			mkdirSync(outdir, { recursive: true });
			copyFileSync(wasmPath, path.join(outdir, wasmFileName));

			// _bg.js のラッパー関数名を収集（公開 API のみ）
			const bgJsContent = readFileSync(path.join(pkgDir, bgJsName), 'utf8');
			const publicFns = [...bgJsContent.matchAll(/^export function ((?:encode|decode)\w+)\b/gm)].map(m => m[1]);
			const reExports = publicFns.map(n => `export const ${n} = bgJs.${n};`).join('\n');

			return {
				resolveDir: path.resolve(pkgDir),
				loader: 'js',
				contents: `
import * as bgJs from './${bgJsName}';
const _res = await fetch(new URL('./${wasmFileName}', import.meta.url));
const _mod = await WebAssembly.compileStreaming(_res);
const _importNames = [...new Set(WebAssembly.Module.imports(_mod).map(i => i.module))];
const _importObj = Object.fromEntries(_importNames.map(name => [name, bgJs]));
const _inst = await WebAssembly.instantiate(_mod, _importObj);
bgJs.__wbg_set_wasm(_inst.exports);
if (_inst.exports.__wbindgen_start) _inst.exports.__wbindgen_start();
${reExports}
`,
			};
		});
	},
};

// 成果物の出力先を確保
mkdirSync('public', { recursive: true });

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
	outfile: 'public/app.js',
	format: 'esm',
	plugins: [wasmPlugin, cssPlugin],
});

// Service Worker（DOM なし・別バンドル・IIFE 形式）
const swCtx = await esbuild.context({
	...commonOptions,
	entryPoints: ['src/serviceWorker.ts'],
	outfile: 'public/sw.js',
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
