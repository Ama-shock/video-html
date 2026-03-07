declare module '@ama-shock/non-resident-vapid/pkg/non_resident_vapid_bg.js' {
    export function __wbg_set_wasm(wasm: WebAssembly.Exports): void;
    export function decode_credential_bundle_wasm(
        bundle_b64: string,
        key_id_b64: string,
        private_key_d_b64: string,
    ): { endpoint: string; p256dh: string; auth: string };
}
