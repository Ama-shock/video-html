/**
 * IndexedDB 抽象化レイヤー。
 * IDBDatabase を Promise ベースで扱う最小限のラッパー。
 */

const DB_NAME = 'video-html';
const DB_VERSION = 1;

export type StoreSchema = {
    'identity': { key: string; value: unknown };
    'guests': { key: string; value: unknown };
    'room-keys': { key: string; value: unknown };
    'keymap': { key: string; value: unknown };
    'settings': { key: string; value: unknown };
};

export type StoreName = keyof StoreSchema;

let _db: IDBDatabase | null = null;

export async function openDB(): Promise<IDBDatabase> {
    if (_db) return _db;

    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (ev) => {
            const db = (ev.target as IDBOpenDBRequest).result;
            const stores: StoreName[] = ['identity', 'guests', 'room-keys', 'keymap', 'settings'];
            for (const name of stores) {
                if (!db.objectStoreNames.contains(name)) {
                    db.createObjectStore(name);
                }
            }
        };

        req.onsuccess = (ev) => {
            _db = (ev.target as IDBOpenDBRequest).result;
            resolve(_db);
        };

        req.onerror = () => reject(req.error);
    });
}

export async function dbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
    });
}

export async function dbSet<T>(store: StoreName, key: string, value: T): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function dbDelete(store: StoreName, key: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function dbGetAll<T>(store: StoreName): Promise<{ key: string; value: T }[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const objStore = tx.objectStore(store);
        const results: { key: string; value: T }[] = [];

        const cursorReq = objStore.openCursor();
        cursorReq.onsuccess = (ev) => {
            const cursor = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (cursor) {
                results.push({ key: cursor.key as string, value: cursor.value as T });
                cursor.continue();
            } else {
                resolve(results);
            }
        };
        cursorReq.onerror = () => reject(cursorReq.error);
    });
}
