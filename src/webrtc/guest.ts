/**
 * WebRTC ゲスト実装。
 *
 * - Offer SDP を生成してホストの部屋鍵宛てに JoinRequest を送信
 * - Answer SDP を受け取って WebRTC コネクションを確立
 * - データチャネルでコントローラー入力をホストに送信
 */

import type { StoredIdentity } from '../identity';
import { signMessage } from '../identity';
import { pushToBundle } from '../webpush/gateway';
import { type ConnectionStats, getConnectionStats } from './stats';
import type { ControllerInput, JoinAccepted, JoinRequest } from './types';

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
	callbacks: GuestCallbacks;

	constructor(callbacks: GuestCallbacks = {}) {
		this.callbacks = callbacks;
	}

	/**
	 * 入室要求を送信する。
	 * ホストから Answer SDP が WebPush で届いたら handleAnswer() を呼ぶ。
	 */
	async join(
		roomKey: string, // ホストの部屋鍵 (base64url クレデンシャルバンドル)
		guestBundle: string, // 自分の WebPush サブスクリプションのクレデンシャルバンドル
		identity: StoredIdentity,
		username: string,
	): Promise<void> {
		this.close();

		const pc = new RTCPeerConnection(RTC_CONFIG);
		this.pc = pc;

		pc.onconnectionstatechange = () => {
			// close() 済みなら無視（再入防止）
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

		// ホストが作成したデータチャネルを受信 (host_command)
		pc.ondatachannel = (ev) => {
			const dc = ev.channel;
			if (dc.label === 'host_command') {
				dc.onmessage = (msgEv) => {
					try {
						const cmd = JSON.parse(msgEv.data as string);
						if (cmd.type === 'host_disconnect') {
							// コールバックを先に発火してから切断
							this.callbacks.onConnectionState?.('closed');
							this.close();
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
			offerSdp: pc.localDescription?.sdp ?? '',
		};

		await pushToBundle(roomKey, joinReq, 120);
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
		const pc = this.pc;
		const dc = this.dataChannel;
		// 先に null にして onconnectionstatechange からの再入を防ぐ
		this.pc = null;
		this.dataChannel = null;
		// 切断通知をデータチャネルで送信（ホスト側の即時検知用）
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
