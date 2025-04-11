import { BinaryCode } from "./BinaryCode";
import { initiateServiceWorker } from "./serviceWorker";
import { registerDOM } from "./window";

Object.defineProperty(globalThis, 'BinaryCode', { value: BinaryCode });
const env = globalThis;

if ('Window' in env && env instanceof Window) {
    registerDOM(env);
    const scriptSrc = (document.currentScript as HTMLScriptElement)?.src;
    globalThis.navigator.serviceWorker.register(scriptSrc);
}

if ('ServiceWorkerGlobalScope' in env && env instanceof ServiceWorkerGlobalScope) {
    initiateServiceWorker(env);
}