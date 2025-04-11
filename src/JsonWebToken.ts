import { BinaryCode } from "./BinaryCode";

export type Algorithm = `${'RS'|'PS'|'ES'|'HS'}${256|384|512}`;
export type Header = {
    typ: 'JWT';
    alg: Algorithm;
};

const AlgorithmNames = {
    RS: 'RSASSA-PKCS1-v1_5',
    PS: 'RSASSA-PSS',
    ES: 'ECDSA',
    HS: 'HMAC',
};

export class JsonWebToken<P extends object> {
    #raw: string;
    constructor(jwt: string) {
        this.#raw = jwt;
    }

    toString() {
        return this.#raw;
    }

    #parsed?: {
        header: Header;
        payload: P;
        signature: BinaryCode;
    };
    get #parse() {
        if (!this.#parsed) {
            const [header, payload, signature] = this.#raw.split('.');
            this.#parsed = {
                header: JSON.parse(BinaryCode.fromBase64Url(header).toText()),
                payload: JSON.parse(BinaryCode.fromBase64Url(payload).toText()),
                signature: BinaryCode.fromBase64Url(signature),
            };
        }
        return this.#parsed;
    }

    get header() {
        return this.#parse.header;
    }
    get payload() {
        return this.#parse.payload;
    }
    get signature() {
        return this.#parse.signature;
    }

    static parseAlgorithm(alg: Algorithm) {
        const match = alg.match(/^(RS|PS|ES|HS)(256|384|512)$/);
        const prefix = match?.[1] as keyof typeof AlgorithmNames;
        if (!AlgorithmNames[prefix]) {
            throw new Error(`Unsupported algorithm prefix: ${prefix}`);
        }
        const bits = parseInt(match?.[2]!);
        return {
            name: AlgorithmNames[prefix],
            hash: `SHA-${bits}`,
        };
    }

    static encodeObject(obj: object): string {
        return BinaryCode.fromText(JSON.stringify(obj)).toBase64Url();
    }

    static async sign<P extends object>(
        header: Header,
        payload: P,
        secretKey: CryptoKey
    ): Promise<JsonWebToken<P>> {
        if (secretKey.type !== 'private') {
            throw new Error('key must be private');
        }
        if (secretKey.usages.indexOf('sign') === -1) {
            throw new Error('key must have sign usage');
        }
        const algo = JsonWebToken.parseAlgorithm(header.alg);
        if (secretKey.algorithm.name !== algo.name) {
            throw new Error('key algorithm mismatch');
        }
        const src = `${this.encodeObject(header)}.${this.encodeObject(payload)}`;
        const sign = await crypto.subtle.sign(algo, secretKey, BinaryCode.fromText(src));
        const signBase64 = new BinaryCode(sign).toBase64Url();
        const jwt = `${src}.${signBase64}`;
        return new JsonWebToken<P>(jwt);
    }

    async verify(publicKey: CryptoKey): Promise<boolean> {
        if (publicKey.type !== 'public') {
            throw new Error('key must be public');
        }
        if (publicKey.usages.indexOf('verify') === -1) {
            throw new Error('key must have verify usage');
        }
        const algo = JsonWebToken.parseAlgorithm(this.header.alg);
        if (publicKey.algorithm.name !== algo.name) {
            throw new Error('key algorithm mismatch');
        }
        const [header, payload] = this.#raw.split('.');
        const src = BinaryCode.fromText(`${header}.${payload}`);
        return crypto.subtle.verify(algo, publicKey, this.signature, src);
    }
}