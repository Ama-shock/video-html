import { ECDH, createHmac, createCipheriv } from 'crypto';

type Params = {
    dh: string;
    privateKey: ECDH;
    salt: string;
    authSecret: string;
};


const AES_GCM = 'aes-128-gcm';
const PAD_SIZE = 1;
const TAG_LENGTH = 16;
const KEY_LENGTH = 16;
const NONCE_LENGTH = 12;
const SHA_256_LENGTH = 32;
const MODE_ENCRYPT = 'encrypt';
const MODE_DECRYPT = 'decrypt';
type MODE = 'encrypt' | 'decrypt';

export function encrypt(buffer: Buffer, params: Params) {  
    if (!Buffer.isBuffer(buffer)) {
        throw new Error('buffer argument must be a Buffer');
    }
    const header = parseParams(params);

    var result;
    result = writeHeader(header);

    const { key, nonce } = deriveKeyAndNonce(header, MODE_ENCRYPT);
    let start = 0;
    const overhead = PAD_SIZE + TAG_LENGTH;
    let pad = 0;

    let counter = 0;
    let last = false;
    while (!last) {
        // Pad so that at least one data byte is in a block.
        var recordPad = Math.min(header.rs - overhead - 1, pad);
        if (pad > 0 && recordPad === 0) {
        ++recordPad; // Deal with perverse case of rs=overhead+1 with padding.
        }
        pad -= recordPad;

        var end = start + header.rs - overhead - recordPad;
        last = end >= buffer.length;
        last = last && pad <= 0;
        var block = encryptRecord(key, nonce, counter, buffer.slice(start, end), recordPad, header, last);
        result = Buffer.concat([result, block]);

        start = end;
        ++counter;
    }
    return result;
}


/* Parse command-line arguments. */
function parseParams(params: Params) {
    return {
        rs: 4096,
        privateKey: params.privateKey,
        keyid: params.privateKey.getPublicKey(),
        salt: decode(params.salt),
        dh: decode(params.dh),
        authSecret: decode(params.authSecret),
    };
}
type Header = ReturnType<typeof parseParams>;
  
function decode(b: string|Buffer) {
    if (typeof b === 'string') {
        return Buffer.from(b, 'base64url');
    }
    return b;
}

function writeHeader(header: Header) {
    var ints = Buffer.alloc(5);
    var keyid = Buffer.from(header.keyid || []);
    if (keyid.length > 255) {
      throw new Error('keyid is too large');
    }
    ints.writeUIntBE(header.rs, 0, 4);
    ints.writeUIntBE(keyid.length, 4, 1);
    return Buffer.concat([header.salt, ints, keyid]);
}



function webpushSecret(header: Header, mode: MODE) {
    if (!header.authSecret) {
      throw new Error('No authentication secret for webpush');
    }
    keylog('authsecret', header.authSecret);
  
    var remotePubKey, senderPubKey, receiverPubKey;
    if (mode === MODE_ENCRYPT) {
      senderPubKey = header.privateKey.getPublicKey();
      remotePubKey = receiverPubKey = header.dh;
    } else if (mode === MODE_DECRYPT) {
      remotePubKey = senderPubKey = header.keyid;
      receiverPubKey = header.privateKey.getPublicKey();
    } else {
      throw new Error('Unknown mode only ' + MODE_ENCRYPT +
                      ' and ' + MODE_DECRYPT + ' supported');
    }
    keylog('remote pubkey', remotePubKey);
    keylog('sender pubkey', senderPubKey);
    keylog('receiver pubkey', receiverPubKey);
    return keylog('secret dh',
                  HKDF(header.authSecret,
                       header.privateKey.computeSecret(remotePubKey),
                       Buffer.concat([
                         Buffer.from('WebPush: info\0'),
                         receiverPubKey,
                         senderPubKey
                       ]),
                       SHA_256_LENGTH));
}

function deriveKeyAndNonce(header: Header, mode: MODE) {
    var keyInfo;
    var nonceInfo;
    var secret;
    
    // latest
    keyInfo = Buffer.from('Content-Encoding: aes128gcm\0');
    nonceInfo = Buffer.from('Content-Encoding: nonce\0');
    secret = webpushSecret(header, mode);
      
    var prk = HKDF_extract(header.salt, secret);
    var result = {
      key: HKDF_expand(prk, keyInfo, KEY_LENGTH),
      nonce: HKDF_expand(prk, nonceInfo, NONCE_LENGTH)
    };
    keylog('key', result.key);
    keylog('nonce base', result.nonce);
    return result;
}

function generateNonce(base: Buffer, counter: number) {
    var nonce = Buffer.from(base);
    var m = nonce.readUIntBE(nonce.length - 6, 6);
    var x = ((m ^ counter) & 0xffffff) +
        ((((m / 0x1000000) ^ (counter / 0x1000000)) & 0xffffff) * 0x1000000);
    nonce.writeUIntBE(x, nonce.length - 6, 6);
    keylog('nonce' + counter, nonce);
    return nonce;
}

function encryptRecord(key: Buffer, nonce: Buffer, counter: number, buffer: Buffer, pad: number, header: Header, last: boolean) {
    keylog('encrypt', buffer);
    pad = pad || 0;
    var nonce = generateNonce(nonce, counter);
    var gcm = createCipheriv(AES_GCM, key, nonce);
  
    var ciphertext = [];
    var padding = Buffer.alloc(pad + PAD_SIZE);
    padding.fill(0);

    padding.writeUIntBE(pad, 0, PAD_SIZE);
    keylog('padding', padding);
    ciphertext.push(gcm.update(padding));
    ciphertext.push(gcm.update(buffer));

    if (!last && padding.length + buffer.length < header.rs) {
    throw new Error('Unable to pad to record size');
    }
  
    gcm.final();
    var tag = gcm.getAuthTag();
    if (tag.length !== TAG_LENGTH) {
      throw new Error('invalid tag generated');
    }
    ciphertext.push(tag);
    return keylog('encrypted', Buffer.concat(ciphertext));
}

  
function HMAC_hash(key: Buffer, input: Buffer) {
    var hmac = createHmac('sha256', key);
    hmac.update(input);
    return hmac.digest();
}

/* HKDF as defined in RFC5869, using SHA-256 */
function HKDF_extract(salt: Buffer, ikm: Buffer) {
    keylog('salt', salt);
    keylog('ikm', ikm);
    return keylog('extract', HMAC_hash(salt, ikm));
}

function HKDF_expand(prk: Buffer, info: Buffer, l: number) {
    keylog('prk', prk);
    keylog('info', info);
    var output = Buffer.alloc(0);
    var T = Buffer.alloc(0);
    var counter = 0;
    var cbuf = Buffer.alloc(1);
    while (output.length < l) {
    cbuf.writeUIntBE(++counter, 0, 1);
    T = HMAC_hash(prk, Buffer.concat([T, info, cbuf]));
    output = Buffer.concat([output, T]);
    }

    return keylog('expand', output.slice(0, l));
}
  
function HKDF(salt: Buffer, ikm: Buffer, info: Buffer, len: number) {
    return HKDF_expand(HKDF_extract(salt, ikm), info, len);
}


function keylog(m: string, k: Buffer) {
    console.warn(m + ' [' + k.length + ']: ' + k.toString('base64url'));
    return k;
};