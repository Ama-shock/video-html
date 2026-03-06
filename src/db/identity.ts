/**
 * ユーザーアイデンティティの永続化。
 *
 * Ed25519 鍵ペア:
 *   - 秘密鍵: extractable=false の CryptoKey として IndexedDB に保存
 *   - 公開鍵: 生バイト (raw) + base64url 文字列で保存
 *
 * プロフィール: { username: string }
 */

import { dbGet, dbSet } from './index';

export type StoredIdentity = {
    privateKey: CryptoKey;            // extractable=false Ed25519 秘密鍵
    publicKeyRaw: Uint8Array;         // 32-byte Ed25519 公開鍵
    publicKeyB64: string;             // base64url エンコード
};

export type UserProfile = {
    username: string;
};

export async function loadIdentity(): Promise<StoredIdentity | null> {
    const priv = await dbGet<CryptoKey>('identity', 'privateKey');
    const pubRaw = await dbGet<Uint8Array>('identity', 'publicKeyRaw');
    const pubB64 = await dbGet<string>('identity', 'publicKeyB64');
    if (!priv || !pubRaw || !pubB64) return null;
    return { privateKey: priv, publicKeyRaw: pubRaw, publicKeyB64: pubB64 };
}

export async function saveIdentity(identity: StoredIdentity): Promise<void> {
    await dbSet('identity', 'privateKey', identity.privateKey);
    await dbSet('identity', 'publicKeyRaw', identity.publicKeyRaw);
    await dbSet('identity', 'publicKeyB64', identity.publicKeyB64);
}

export async function loadProfile(): Promise<UserProfile | null> {
    return dbGet<UserProfile>('identity', 'profile');
}

export async function saveProfile(profile: UserProfile): Promise<void> {
    await dbSet('identity', 'profile', profile);
}
