import { sendNotification as libSend } from 'web-push';
import { sendNotification } from "./send";
import { generateVAPIDKeys } from "./vapid";

import * as keyPair from '../../.keys/serverKeyPair.json';
import * as subscription from '../../.keys/subscription.json';
import { BinaryCode } from '../BinaryCode';

switch(process.argv[2]) {
case 'generate':
    generateKeyPair();
    break;
case 'send':
    sendTestNotification();
    break;
case 'lib':
    sendWithLib();
    break;
default:
    console.error('Usage: node exec.js generate|send|lib');
    process.exit(1);
}

async function generateKeyPair() {
    const keyPair = await generateVAPIDKeys();
    console.log('Key Pair:', JSON.stringify(keyPair, null, 4));
}

async function sendTestNotification() {
    await sendNotification(subscription, keyPair, 'Hello, World!');
    console.log('Notification sent successfully');
}

async function sendWithLib() {
    const privateKey = BinaryCode.fromHex(keyPair.rawPrivate.replace(/:/g, '')).toBase64Url();
    await libSend(subscription, 'Hello, World!', {
        vapidDetails: {
            subject: 'https://localhost:5500',
            privateKey,
            publicKey: keyPair.publicKey,
        }
    });
    console.log('Notification sent successfully');
}