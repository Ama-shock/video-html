import * as nodeCrypto from 'crypto';
import * as ece from './ece';
import { KeyPair, vapidAuthorization } from './vapid';

export type Subscription = {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
};


// Default TTL is four weeks.
const DEFAULT_TTL = 2419200 as const;

const ContentEncodings = {
    AES_GCM: 'aesgcm',
    AES_128_GCM: 'aes128gcm'
} as const;
  
const Urgency = {
    VERY_LOW: 'very-low',
    LOW: 'low',
    NORMAL: 'normal',
    HIGH: 'high'
} as const;

const contentEncoding = ContentEncodings.AES_128_GCM;

const serviceUrl = 'http://localhost:5500/docs';

export async function sendNotification(subscription: Subscription, keyPair: KeyPair, payload: string|Buffer) {
    const encrypted = encrypt(subscription.keys.p256dh, subscription.keys.auth, payload);

    const url = new URL(subscription.endpoint);
    const authorization = await vapidAuthorization(
        keyPair,
        url.origin,
        serviceUrl
    );

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            TTL: String(DEFAULT_TTL),
            Urgency: Urgency.NORMAL,
            Authorization: authorization,
            'Content-Encoding': contentEncoding,
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(encrypted.length),
        },
        body: encrypted,
    });
    console.log('Response:', response.status, response.statusText);
    console.log('Response Headers:', response.headers);
    console.log('Response Body:', await response.text());
};



function encrypt (userPublicKey: string, userAuth: string, payload: string|Buffer) {
    if (!userPublicKey) {
        throw new Error('No user public key provided for encryption.');
    }

    if (typeof userPublicKey !== 'string') {
        throw new Error('The subscription p256dh value must be a string.');
    }

    if (Buffer.from(userPublicKey, 'base64url').length !== 65) {
        throw new Error('The subscription p256dh value should be 65 bytes long.');
    }

    if (!userAuth) {
        throw new Error('No user auth provided for encryption.');
    }

    if (typeof userAuth !== 'string') {
        throw new Error('The subscription auth key must be a string.');
    }

    if (Buffer.from(userAuth, 'base64url').length < 16) {
        throw new Error('The subscription auth key should be at least 16 '
        + 'bytes long');
    }

    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
        throw new Error('Payload must be either a string or a Node Buffer.');
    }

    if (typeof payload === 'string' || payload instanceof String) {
        payload = Buffer.from(payload);
    }

    const localCurve = nodeCrypto.createECDH('prime256v1');
    const localPublicKey = localCurve.generateKeys();

    const salt = nodeCrypto.randomBytes(16).toString('base64url');

    return ece.encrypt(payload, {
        dh: userPublicKey,
        privateKey: localCurve,
        salt: salt,
        authSecret: userAuth
    });
};

