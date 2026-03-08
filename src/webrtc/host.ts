/**
 * WebRTC ホスト実装。
 *
 * - ゲストからの JoinRequest を受け取って PeerConnection を作成
 * - MediaStream を送信し、データチャネルでコントローラー入力を受け取る
 * - Answer SDP をゲストの WebPush バンドル宛てに送信する
 */

import { pushToBundle } from '../webpush/gateway';
import { type ConnectionStats, getConnectionStats } from './stats';
import type { ControllerInput, HostCommand, JoinAccepted, JoinRejected, JoinRequest } from './types';

const RTC_CONFIG: RTCConfiguration = {
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

/** 品質ごとの映像ビットレート上限 (bps) */
const QUALITY_BITRATE: Record<string, number> = {
	high: 4_000_000, // 4 Mbps
	medium: 1_500_000, // 1.5 Mbps
	low: 600_000, // 600 kbps
};

export type GuestSession = {
	userId: string;
	username: string;
	guestBundle: string;
	pc: RTCPeerConnection;
	/** ゲストが作成したデータチャネル (controller input 受信用) */
	controllerChannel: RTCDataChannel | null;
	/** ホストが作成したデータチャネル (コマンド送信用) */
	commandChannel: RTCDataChannel | null;
	connectionState: RTCPeerConnectionState;
};

type HostCallbacks = {
	onControllerInput?: (userId: string, input: ControllerInput) => void;
	onGuestStateChange?: (userId: string, state: RTCPeerConnectionState) => void;
};

export class HostWebRTC {
	private sessions = new Map<string, GuestSession>();
	private localStream: MediaStream | null = null;
	private callbacks: HostCallbacks;

	constructor(callbacks: HostCallbacks = {}) {
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

	/** ホストプロフィール（JoinAccepted に含める） */
	private hostProfile: { userId: string; username: string } | null = null;

	setHostProfile(userId: string, username: string): void {
		this.hostProfile = { userId, username };
	}

	/**
	 * ゲストの JoinRequest を処理して Answer SDP を送り返す。
	 */
	async handleJoinRequest(req: JoinRequest, videoQuality?: string): Promise<void> {
		const { profile, guestBundle, offerSdp } = req;
		const { userId, username } = profile;

		// 既存セッションがあれば閉じる
		this.disconnectGuest(userId);

		const pc = new RTCPeerConnection(RTC_CONFIG);

		// ホスト→ゲスト用コマンドチャネル作成
		const commandChannel = pc.createDataChannel('host_command', { ordered: true });

		// ゲストが作成したデータチャネル受け取り (controller input)
		pc.ondatachannel = (ev) => {
			const dc = ev.channel;
			dc.onmessage = (msgEv) => {
				try {
					const msg = JSON.parse(msgEv.data as string);
					if (msg.type === 'guest_disconnect') {
						this.callbacks.onGuestStateChange?.(userId, 'closed');
						this.disconnectGuest(userId);
						return;
					}
					this.callbacks.onControllerInput?.(userId, msg as ControllerInput);
				} catch {
					/* ignore */
				}
			};
			const session = this.sessions.get(userId);
			if (session) session.controllerChannel = dc;
		};

		pc.onconnectionstatechange = () => {
			// sessions に存在しなければ既に切断処理済み（再入防止）
			const session = this.sessions.get(userId);
			if (!session) return;
			session.connectionState = pc.connectionState;
			this.callbacks.onGuestStateChange?.(userId, pc.connectionState);
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
			controllerChannel: null,
			commandChannel,
			connectionState: 'new',
		};
		this.sessions.set(userId, session);

		// Offer を受け取って Answer を生成
		await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
		const answer = await pc.createAnswer();
		await pc.setLocalDescription(answer);

		// ICE gathering を待つ
		await waitForIceGathering(pc);

		// 初期ビットレート制限を適用
		if (videoQuality) {
			await applyBitrateLimit(pc, videoQuality);
		}

		const answerMsg: JoinAccepted = {
			type: 'join_accepted',
			answerSdp: pc.localDescription?.sdp ?? '',
			controllerAssignment: null,
			videoQuality,
			hostProfile: this.hostProfile ?? undefined,
		};

		await pushToBundle(guestBundle, answerMsg, 60);
	}

	/**
	 * ゲストの映像品質を変更する。
	 * ビットレート制限を適用し、データチャネルでゲストに通知する。
	 */
	async setVideoQuality(userId: string, quality: string): Promise<void> {
		const session = this.sessions.get(userId);
		if (!session) return;

		// ビットレート制限を適用
		await applyBitrateLimit(session.pc, quality);

		// ゲストに通知
		const cmd: HostCommand = { type: 'quality_change', videoQuality: quality };
		if (session.commandChannel?.readyState === 'open') {
			session.commandChannel.send(JSON.stringify(cmd));
		}
	}

	async rejectGuest(guestBundle: string, reason?: string): Promise<void> {
		const msg: JoinRejected = { type: 'join_rejected', reason };
		await pushToBundle(guestBundle, msg, 60);
	}

	disconnectGuest(userId: string): void {
		const session = this.sessions.get(userId);
		if (session) {
			// Map から先に削除して onconnectionstatechange の再入を防ぐ
			this.sessions.delete(userId);
			// 切断通知をデータチャネルで送信（相手側の即時検知用）
			if (session.commandChannel?.readyState === 'open') {
				try {
					session.commandChannel.send(JSON.stringify({ type: 'host_disconnect' }));
				} catch {
					/* ignore */
				}
			}
			session.pc.close();
		}
	}

	disconnectAll(): void {
		for (const [userId] of this.sessions) {
			this.disconnectGuest(userId);
		}
	}

	async getGuestStats(userId: string): Promise<ConnectionStats | null> {
		const session = this.sessions.get(userId);
		if (!session) return null;
		return getConnectionStats(session.pc);
	}

	getSession(userId: string): GuestSession | undefined {
		return this.sessions.get(userId);
	}

	getSessions(): GuestSession[] {
		return Array.from(this.sessions.values());
	}
}

/**
 * RTCRtpSender の映像ビットレートを制限する。
 */
async function applyBitrateLimit(pc: RTCPeerConnection, quality: string): Promise<void> {
	const maxBitrate = QUALITY_BITRATE[quality];
	if (!maxBitrate) return;

	const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
	if (!sender) return;

	const params = sender.getParameters();
	if (!params.encodings || params.encodings.length === 0) {
		params.encodings = [{}];
	}
	for (const enc of params.encodings) {
		enc.maxBitrate = maxBitrate;
	}
	await sender.setParameters(params);
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
