/**
 * WebRTC ゲスト実装。
 *
 * Phase 1: DataChannel のみの SDP を WebPush で交換して接続確立
 * Phase 2: ホストがメディアトラック追加 → DC 経由で offer/answer を再ネゴシエーション
 */

import type { StoredIdentity } from '../identity';
import { signMessage } from '../identity';
import { pushToBundle } from '../webpush/gateway';
import { type ConnectionStats, getConnectionStats } from './stats';
import type { ControllerInput, GuestIntroduce, JoinAccepted, JoinRequest } from './types';

const RTC_CONFIG: RTCConfiguration = {
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

export type GuestCallbacks = {
	onRemoteStream?: (stream: MediaStream) => void;
	onConnectionState?: (state: RTCPeerConnectionState) => void;
	onControllerAssignment?: (controllerId: number | null) => void;
	onHostCommand?: (cmd: { type: string; [key: string]: unknown }) => void;
};

export class GuestWebRTC {
	private pc: RTCPeerConnection | null = null;
	private dataChannel: RTCDataChannel | null = null;
	/** host_command チャネル（ホスト側作成、再ネゴシエーション応答にも使う） */
	private hostCommandChannel: RTCDataChannel | null = null;
	private _pendingIntroduce: GuestIntroduce | null = null;
	callbacks: GuestCallbacks;

	constructor(callbacks: GuestCallbacks = {}) {
		this.callbacks = callbacks;
	}

	/**
	 * 入室要求を送信する。
	 * Phase 1: DataChannel のみの Offer を WebPush で送信。
	 */
	async join(
		roomKey: string,
		guestBundle: string,
		identity: StoredIdentity,
		username: string,
	): Promise<void> {
		this.close();

		const pc = new RTCPeerConnection(RTC_CONFIG);
		this.pc = pc;

		pc.onconnectionstatechange = () => {
			if (!this.pc) return;
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

		// ホストが作成したデータチャネルを受信
		pc.ondatachannel = (ev) => {
			const dc = ev.channel;
			if (dc.label === 'host_command') {
				this.hostCommandChannel = dc;
				dc.onmessage = (msgEv) => {
					try {
						const cmd = JSON.parse(msgEv.data as string);
						if (cmd.type === 'host_disconnect') {
							this.callbacks.onConnectionState?.('closed');
							this.close();
							return;
						}
						// Phase 2: ホストからのメディア再ネゴシエーション offer
						if (cmd.type === 'media_offer') {
							this.handleMediaOffer(cmd.sdp as string);
							return;
						}
						this.callbacks.onHostCommand?.(cmd);
					} catch {
						/* ignore */
					}
				};
			}
		};

		// データチャネル作成（コントローラー入力送信用）
		const dc = pc.createDataChannel('controller', { ordered: false, maxRetransmits: 0 });
		dc.onopen = () => {
			if (this._pendingIntroduce) {
				dc.send(JSON.stringify(this._pendingIntroduce));
				this._pendingIntroduce = null;
			}
		};
		this.dataChannel = dc;

		// Phase 1: DataChannel のみの Offer（メディアトランシーバーなし → SDP が小さい）
		const offer = await pc.createOffer();
		await pc.setLocalDescription(offer);

		await waitForIceGathering(pc);

		// 署名
		const message = new TextEncoder().encode(identity.publicKeyB64 + username);
		const sig = await signMessage(identity, message);

		const finalSdp = pc.localDescription?.sdp ?? '';
		const joinReq: JoinRequest = {
			type: 'join_request',
			userId: identity.publicKeyB64,
			guestBundle,
			offerSdp: finalSdp,
		};

		this._pendingIntroduce = {
			type: 'guest_introduce',
			profile: {
				userId: identity.publicKeyB64,
				username,
				signature: toBase64Url(sig),
			},
		};

		await pushToBundle(roomKey, joinReq, 120);
	}

	/**
	 * WebPush で受信した Answer SDP を設定（Phase 1 完了）。
	 */
	async handleAnswer(msg: JoinAccepted): Promise<void> {
		if (!this.pc) throw new Error('No active peer connection');
		await this.pc.setRemoteDescription({ type: 'answer', sdp: msg.answerSdp });
	}

	/**
	 * Phase 2: ホストからのメディア offer を処理して answer を返す。
	 */
	private async handleMediaOffer(sdp: string): Promise<void> {
		const pc = this.pc;
		if (!pc) return;
		await pc.setRemoteDescription({ type: 'offer', sdp });
		const answer = await pc.createAnswer();
		await pc.setLocalDescription(answer);
		await waitForIceGathering(pc);
		const answerSdp = pc.localDescription?.sdp ?? '';
		if (this.hostCommandChannel?.readyState === 'open') {
			this.hostCommandChannel.send(JSON.stringify({ type: 'media_answer', sdp: answerSdp }));
		}
	}

	sendControllerInput(input: ControllerInput): void {
		if (this.dataChannel?.readyState === 'open') {
			this.dataChannel.send(JSON.stringify(input));
		}
	}

	close(): void {
		const pc = this.pc;
		const dc = this.dataChannel;
		this.pc = null;
		this.dataChannel = null;
		this.hostCommandChannel = null;
		if (dc?.readyState === 'open') {
			try {
				dc.send(JSON.stringify({ type: 'guest_disconnect' }));
			} catch {
				/* ignore */
			}
		}
		dc?.close();
		pc?.close();
	}

	async getStats(): Promise<ConnectionStats | null> {
		if (!this.pc) return null;
		return getConnectionStats(this.pc);
	}

	get isConnected(): boolean {
		return this.pc?.connectionState === 'connected';
	}
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
	if (pc.iceGatheringState === 'complete') return Promise.resolve();
	return new Promise((resolve) => {
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
