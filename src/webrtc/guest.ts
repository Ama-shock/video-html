/**
 * WebRTC ゲスト実装。
 *
 * - Offer SDP を生成してホストの部屋鍵宛てに JoinRequest を送信
 * - Answer SDP を受け取って WebRTC コネクションを確立
 * - データチャネルでコントローラー入力をホストに送信
 */

import { pushToBundle } from '../webpush/gateway';
import { signMessage } from '../identity';
import type { StoredIdentity } from '../identity';
import type { JoinRequest, JoinAccepted, ControllerInput } from './types';
import type { WebPushSubscriptionInfo } from '../webpush/subscription';

const RTC_CONFIG: RTCConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
};

type GuestCallbacks = {
    onRemoteStream?: (stream: MediaStream) => void;
    onConnectionState?: (state: RTCPeerConnectionState) => void;
    onControllerAssignment?: (controllerId: number | null) => void;
};

export class GuestWebRTC {
    private pc: RTCPeerConnection | null = null;
    private dataChannel: RTCDataChannel | null = null;
    private callbacks: GuestCallbacks;
    private gatewayUrl: string;

    constructor(gatewayUrl: string, callbacks: GuestCallbacks = {}) {
        this.gatewayUrl = gatewayUrl;
        this.callbacks = callbacks;
    }

    /**
     * 入室要求を送信する。
     * ホストから Answer SDP が WebPush で届いたら handleAnswer() を呼ぶ。
     */
    async join(
        roomKey: string,         // ホストの部屋鍵 (base64url クレデンシャルバンドル)
        guestBundle: string,     // 自分の WebPush サブスクリプションのクレデンシャルバンドル
        identity: StoredIdentity,
        username: string,
    ): Promise<void> {
        this.close();

        const pc = new RTCPeerConnection(RTC_CONFIG);
        this.pc = pc;

        pc.onconnectionstatechange = () => {
            this.callbacks.onConnectionState?.(pc.connectionState);
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this.close();
            }
        };

        pc.ontrack = (ev) => {
            if (ev.streams[0]) {
                this.callbacks.onRemoteStream?.(ev.streams[0]);
            }
        };

        // データチャネル作成（コントローラー入力送信用）
        const dc = pc.createDataChannel('controller', { ordered: false, maxRetransmits: 0 });
        this.dataChannel = dc;

        // Offer SDP 生成
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // ICE gathering 待機
        await waitForIceGathering(pc);

        // 署名: userId || username を sign
        const message = new TextEncoder().encode(identity.publicKeyB64 + username);
        const sig = await signMessage(identity, message);

        const joinReq: JoinRequest = {
            type: 'join_request',
            profile: {
                userId: identity.publicKeyB64,
                username,
                signature: toBase64Url(sig),
            },
            guestBundle,
            offerSdp: pc.localDescription!.sdp,
        };

        await pushToBundle(roomKey, joinReq, this.gatewayUrl, 120);
    }

    /**
     * ホストから Answer SDP が届いたら呼ぶ。
     */
    async handleAnswer(msg: JoinAccepted): Promise<void> {
        if (!this.pc) throw new Error('No active peer connection');
        await this.pc.setRemoteDescription({ type: 'answer', sdp: msg.answerSdp });
        this.callbacks.onControllerAssignment?.(msg.controllerAssignment);
    }

    /**
     * コントローラー入力をホストに送信する（データチャネル経由）。
     */
    sendControllerInput(input: ControllerInput): void {
        if (this.dataChannel?.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(input));
        }
    }

    close(): void {
        this.dataChannel?.close();
        this.pc?.close();
        this.dataChannel = null;
        this.pc = null;
    }

    get isConnected(): boolean {
        return this.pc?.connectionState === 'connected';
    }
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
        const check = () => {
            if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', check);
                resolve();
            }
        };
        pc.addEventListener('icegatheringstatechange', check);
        setTimeout(resolve, 5000);
    });
}

function toBase64Url(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}
