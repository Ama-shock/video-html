import * as nodeCrypto from 'crypto';
import { BinaryCode } from '../BinaryCode';
import { JsonWebToken } from '../JsonWebToken';

export type KeyPair = {
    publicKey: string;
    privateKey: string;
};

export async function generateVAPIDKeys() {
    const key = await crypto.subtle.generateKey({
        name: 'ECDSA',
        namedCurve: 'P-256',
    }, true, ['sign', 'verify']);
    
    const publicKeyBuffer = await crypto.subtle.exportKey('raw', key.publicKey);
    const privateKey = await crypto.subtle.exportKey('pkcs8', key.privateKey);

    return {
        publicKey: new BinaryCode(publicKeyBuffer).toBase64Url(),
        privateKey: new BinaryCode(privateKey).toBase64(),
    };
}

function base64encode(data:Uint8Array){
    return btoa([...data].map(n => String.fromCharCode(n)).join(""));
}

function generateNodeVAPIDKeys() {
    const curve = nodeCrypto.createECDH('prime256v1');
    curve.generateKeys();
  
    let publicKeyBuffer = curve.getPublicKey();
    let privateKeyBuffer = curve.getPrivateKey();
  
    // Occassionally the keys will not be padded to the correct lengh resulting
    // in errors, hence this padding.
    // See https://github.com/web-push-libs/web-push/issues/295 for history.
    if (privateKeyBuffer.length < 32) {
        const padding = Buffer.alloc(32 - privateKeyBuffer.length);
        padding.fill(0);
        privateKeyBuffer = Buffer.concat([padding, privateKeyBuffer]);
    }

    if (publicKeyBuffer.length < 65) {
        const padding = Buffer.alloc(65 - publicKeyBuffer.length);
        padding.fill(0);
        publicKeyBuffer = Buffer.concat([padding, publicKeyBuffer]);
    }
  
    return {
        publicKey: publicKeyBuffer.toString('base64url'),
        privateKey: privateKeyBuffer.toString('base64url')
    };
}

/**
 * DEFAULT_EXPIRATION is set to seconds in 12 hours
 */
const DEFAULT_EXPIRATION_SECONDS = 12 * 60 * 60;

export async function vapidAuthorization(keyPair: KeyPair, audience: string, subject: string) {
    const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        BinaryCode.fromBase64(keyPair.privateKey),
        {
            name: 'ECDSA',
            namedCurve: 'P-256'
        },
        true,
        ['sign']
    );
    const header = {
        typ: 'JWT',
        alg: 'ES256'
    } as const;

    const expiration = Math.floor(Date.now() / 1000) + DEFAULT_EXPIRATION_SECONDS;
    const payload = {
        aud: audience,
        exp: expiration,
        sub: subject
    };
    const jwt = await JsonWebToken.sign(header, payload, privateKey);
    console.log('JWT:', jwt.header, jwt.payload);

    return `vapid t=${jwt.toString()}, k=${keyPair.publicKey}`;
}