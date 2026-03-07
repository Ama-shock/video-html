/**
 * WebRTC ホスト実装。
 *
 * - ゲストからの JoinRequest を受け取って PeerConnection を作成
 * - MediaStream を送信し、データチャネルでコントローラー入力を受け取る
 * - Answer SDP をゲストの WebPush バンドル宛てに送信する
 */

import { pushToBundle } from '../webpush/gateway';
import type { ControllerInput, JoinAccepted, JoinRejected, JoinRequest } from './types';

const RTC_CONFIG: RTCConfiguration = {
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

export type GuestSession = {
	userId: string;
	username: string;
	guestBundle: string;
	pc: RTCPeerConnection;
	dataChannel: RTCDataChannel | null;
	connectionState: RTCPeerConnectionState;
};

type HostCallbacks = {
	onControllerInput?: (userId: string, input: ControllerInput) => void;
	onGuestStateChange?: (userId: string, state: RTCPeerConnectionState) => void;
};

export class HostWebRTC {
	private sessions = new Map<string, GuestSession>();
	private localStream: MediaStream | null = null;
	private gatewayUrl: string;
	private callbacks: HostCallbacks;

	constructor(gatewayUrl: string, callbacks: HostCallbacks = {}) {
		this.gatewayUrl = gatewayUrl;
		this.callbacks = callbacks;
	}

	setLocalStream(stream: MediaStream): void {
		this.localStream = stream;
		// 既存セッションにもトラックを追加
		for (const [, session] of this.sessions) {
			const senders = session.pc.getSenders();
			for (const track of stream.getTracks()) {
				if (!senders.find((s) => s.track?.kind === track.kind)) {
					session.pc.addTrack(track, stream);
				}
			}
		}
	}

	/**
	 * ゲストの JoinRequest を処理して Answer SDP を送り返す。
	 */
	async handleJoinRequest(req: JoinRequest): Promise<void> {
		const { profile, guestBundle, offerSdp } = req;
		const { userId, username } = profile;

		// 既存セッションがあれば閉じる
		this.disconnectGuest(userId);

		const pc = new RTCPeerConnection(RTC_CONFIG);

		// データチャネル受け取り
		pc.ondatachannel = (ev) => {
			const dc = ev.channel;
			dc.onmessage = (msgEv) => {
				try {
					const input = JSON.parse(msgEv.data as string) as ControllerInput;
					this.callbacks.onControllerInput?.(userId, input);
				} catch {
					/* ignore */
				}
			};
			const session = this.sessions.get(userId);
			if (session) session.dataChannel = dc;
		};

		pc.onconnectionstatechange = () => {
			const session = this.sessions.get(userId);
			if (session) {
				session.connectionState = pc.connectionState;
				this.callbacks.onGuestStateChange?.(userId, pc.connectionState);
			}
			if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
				this.disconnectGuest(userId);
			}
		};

		// ローカルストリームを追加
		if (this.localStream) {
			for (const track of this.localStream.getTracks()) {
				pc.addTrack(track, this.localStream);
			}
		}

		const session: GuestSession = {
			userId,
			username,
			guestBundle,
			pc,
			dataChannel: null,
			connectionState: 'new',
		};
		this.sessions.set(userId, session);

		// Offer を受け取って Answer を生成
		await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
		const answer = await pc.createAnswer();
		await pc.setLocalDescription(answer);

		// ICE gathering を待つ
		await waitForIceGathering(pc);

		const answerMsg: JoinAccepted = {
			type: 'join_accepted',
			answerSdp: pc.localDescription?.sdp ?? '',
			controllerAssignment: null,
		};

		await pushToBundle(guestBundle, answerMsg, this.gatewayUrl, 60);
	}

	async rejectGuest(guestBundle: string, reason?: string): Promise<void> {
		const msg: JoinRejected = { type: 'join_rejected', reason };
		await pushToBundle(guestBundle, msg, this.gatewayUrl, 60);
	}

	disconnectGuest(userId: string): void {
		const session = this.sessions.get(userId);
		if (session) {
			session.pc.close();
			this.sessions.delete(userId);
		}
	}

	disconnectAll(): void {
		for (const [userId] of this.sessions) {
			this.disconnectGuest(userId);
		}
	}

	getSession(userId: string): GuestSession | undefined {
		return this.sessions.get(userId);
	}

	getSessions(): GuestSession[] {
		return Array.from(this.sessions.values());
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
		// タイムアウト: 5秒待っても完了しなければ強制終了
		setTimeout(resolve, 5000);
	});
}
