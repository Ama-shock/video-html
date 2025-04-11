

export class BinaryCode extends Uint8Array {
    static fromHex(hex: string): BinaryCode {
        const bytes = new this(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
        }
        return bytes;
    }

    static fromBase64(base64: string): BinaryCode {
        const binaryString = atob(base64);
        const bytes = new this(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    static fromBase64Url(base64url: string): BinaryCode {
        const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
        const padding = '='.repeat((4 - (base64.length % 4)) % 4);
        return this.fromBase64(base64 + padding);   
    }

    static fromText(text: string): BinaryCode {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(text);
        return new this(bytes);
    }

    toHex(): string {
        return Array.from(this)
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    }

    toBase64(): string {
        return btoa(String.fromCharCode(...this));
    }

    toBase64Url(): string {
        const base64 = this.toBase64();
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    toText(): string {
        const decoder = new TextDecoder();
        return decoder.decode(this);
    }
}
