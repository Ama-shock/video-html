/**
 * WebRTC ゲスト実装。
 *
 * Phase 1: DataChannel のみの SDP を WebPush で交換して接続確立
 * Phase 2: ホストがメディアトラック追加 → DC 経由で offer/answer を再ネゴシエーション
 */

import type { StoredIdentity } from '../identity';
import { signMessage } from '../identity';
import { pushToBundle } from '../webpush/gateway';
import { getIceConfig } from './iceConfig';
import { type ConnectionStats, getConnectionStats } from './stats';
import type { ControllerInput, GuestIntroduce, JoinAccepted, JoinRequest } from './types';

export type GuestCallbacks = {
	onRemoteStream?: (stream: MediaStream) => void;
	onConnectionState?: (state: RTCPeerConnectionState) => void;
	onControllerAssignment?: (controllerId: number | null) => void;
	onHostCommand?: (cmd: { type: string; [key: string]: unknown }) => void;
	onProgress?: (detail: string) => void;
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

		this.callbacks.onProgress?.('TURN/STUN 設定を取得中...');
		const iceConfig = await getIceConfig();
		const pc = new RTCPeerConnection(iceConfig);
		this.pc = pc;

		pc.onconnectionstatechange = () => {
			if (!this.pc) return;
			const stateLabels: Record<string, string> = {
				new: 'WebRTC: 初期化',
				connecting: 'WebRTC: 接続試行中...',
				connected: 'WebRTC: 接続確立',
				disconnected: 'WebRTC: 切断検出',
				failed: 'WebRTC: 接続失敗',
				closed: 'WebRTC: 終了',
			};
			this.callbacks.onProgress?.(stateLabels[pc.connectionState] ?? pc.connectionState);
			this.callbacks.onConnectionState?.(pc.connectionState);
			if (pc.connectionState === 'closed') {
				this.close();
			}
			// 'failed' では close() しない — Firefox は ICE restart で復帰する場合がある
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
		this.callbacks.onProgress?.('Offer を作成中...');
		const offer = await pc.createOffer();
		await pc.setLocalDescription(offer);

		this.callbacks.onProgress?.('ICE 候補を収集中...');
		await waitForIceGathering(pc);
		this.callbacks.onProgress?.('ICE 収集完了');

		// 署名（タイムスタンプ付き — リプレイ攻撃防止）
		const timestamp = Date.now();
		const message = new TextEncoder().encode(identity.publicKeyB64 + username + timestamp);
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
				timestamp,
				signature: toBase64Url(sig),
			},
		};

		this.callbacks.onProgress?.('Push 送信中...');
		await pushToBundle(roomKey, joinReq, 120);
		this.callbacks.onProgress?.('Push 送信完了 — ホストの応答待ち');
	}

	/**
	 * WebPush で受信した Answer SDP を設定（Phase 1 完了）。
	 */
	async handleAnswer(msg: JoinAccepted): Promise<void> {
		if (!this.pc) throw new Error('No active peer connection');
		// stable 状態（既に Answer 適用済み）なら無視（Push 重複受信対策）
		if (this.pc.signalingState === 'stable') return;
		this.callbacks.onProgress?.('Answer 受信 — ICE 接続中...');
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
		let hasRelay = false;
		const done = () => {
			pc.removeEventListener('icegatheringstatechange', onState);
			pc.removeEventListener('icecandidate', onCandidate);
			resolve();
		};
		const onState = () => {
			if (pc.iceGatheringState === 'complete') done();
		};
		const onCandidate = (e: RTCPeerConnectionIceEvent) => {
			if (e.candidate?.candidate?.includes('typ relay')) hasRelay = true;
		};
		pc.addEventListener('icegatheringstatechange', onState);
		pc.addEventListener('icecandidate', onCandidate);
		// relay 候補が出るまで最大 15 秒、出なければ 5 秒で打ち切り
		setTimeout(() => { if (hasRelay) return; setTimeout(done, 0); }, 5000);
		setTimeout(done, 15000);
	});
}

function toBase64Url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}
