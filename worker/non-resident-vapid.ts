/**
 * non-resident-vapid WASM ラッパー (Cloudflare Workers 用)
 *
 * wasm-bindgen --target bundler の出力を Cloudflare Workers で動かすための
 * 初期化コード。wrangler は .wasm インポートを WebAssembly.Module として返すため、
 * 手動でインスタンス化して _bg.js のグルーコードに接続する。
 */

import wasmModule from '@ama-shock/non-resident-vapid/pkg/non_resident_vapid_bg.wasm';
import * as bgJs from '@ama-shock/non-resident-vapid/pkg/non_resident_vapid_bg.js';

// Build import object dynamically from WASM module imports
const importObject: Record<string, Record<string, WebAssembly.ImportValue>> = {};
for (const { module, name } of WebAssembly.Module.imports(wasmModule)) {
	if (!importObject[module]) importObject[module] = {};
	importObject[module][name] = (bgJs as Record<string, any>)[name];
}

const instance = new WebAssembly.Instance(wasmModule, importObject);
bgJs.__wbg_set_wasm(instance.exports);
(instance.exports.__wbindgen_start as CallableFunction)();

export const { decode_credential_bundle_wasm } = bgJs;
