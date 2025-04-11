
export async function initiateServiceWorker(global: ServiceWorkerGlobalScope) {
    listenEvents(global, {
        async push(ev) {
            console.log('Caught Push Notification', ev);
            const payload = ev.data?.text() || 'No payload';
            await global.registration.showNotification('Test Push Notification', {
                body: payload
            });
        },
        async install(ev) {
            console.log('SW installed', ev);
            global.skipWaiting();
        },
        async activate(ev) {
            console.log('SW activated', ev);
            await global.clients.claim();
        }
    });
}

const ServiceWorkerEvents = [
    'activate',
    'fetch',
    'install',
    'message',
    'messageerror',
    'notificationclick',
    'notificationclose',
    'push',
    'pushsubscriptionchange',
    'error',
    'languagechange',
    'offline',
    'online',
    'rejectionhandled',
    'unhandledrejection',
] as const;


type ServiceWorkerEvents = typeof ServiceWorkerEvents[number];
type ServiceWorkerEventListener<E extends ServiceWorkerEvents> = (event: ServiceWorkerGlobalScopeEventMap[E])=>(void|Promise<void>);
type ServiceWorkerListener = {
    [E in ServiceWorkerEvents]?: ServiceWorkerEventListener<E>;
};

function listenEvents(global: ServiceWorkerGlobalScope, workerListener: ServiceWorkerListener) {
    ServiceWorkerEvents.forEach(event => {
        const eventListener = workerListener[event];
        if (!eventListener) return;
        global.addEventListener(event, ev => {
            const result = eventListener(ev as any);
            if ('waitUntil' in ev && result instanceof Promise) {
                ev.waitUntil(result);
            }
        });
    });
}