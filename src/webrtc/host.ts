/**
 * WebRTC ホスト実装。
 *
 * Phase 1: DataChannel のみの SDP を WebPush で交換して接続確立
 * Phase 2: DC 経由でメディア offer/answer を再ネゴシエーション
 */

import { pushToBundle } from '../webpush/gateway';
import { type ConnectionStats, getConnectionStats } from './stats';
import type { ControllerInput, GuestListCommand, GuestProfile, HostCommand, HostWelcome, JoinAccepted, JoinRejected, JoinRequest, PeerInfo } from './types';

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
	/** Phase 2 メディアネゴシエーション済みか */
	mediaReady: boolean;
	videoQuality?: string;
};

type HostCallbacks = {
	onControllerInput?: (userId: string, input: ControllerInput) => void;
	onGuestStateChange?: (userId: string, state: RTCPeerConnectionState) => void;
	onGuestProfile?: (userId: string, profile: GuestProfile) => void;
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
		// 既存のメディア未送信セッションにもトラックを追加して再ネゴシエーション
		for (const [userId, session] of this.sessions) {
			if (!session.mediaReady && session.commandChannel?.readyState === 'open') {
				this.startMediaNegotiation(userId);
			}
		}
	}

	/** ホストプロフィール */
	private hostProfile: { userId: string; username: string } | null = null;

	setHostProfile(userId: string, username: string): void {
		this.hostProfile = { userId, username };
	}

	/**
	 * Phase 1: DataChannel のみの Answer を WebPush で返す。
	 * メディアトラックはまだ追加しない。
	 */
	async handleJoinRequest(req: JoinRequest, videoQuality?: string, assignment?: { controllerId: number; playerNumber: number | null }): Promise<void> {
		const { userId, guestBundle, offerSdp } = req;

		this.disconnectGuest(userId);

		const pc = new RTCPeerConnection(RTC_CONFIG);

		// ホスト→ゲスト用コマンドチャネル作成
		const commandChannel = pc.createDataChannel('host_command', { ordered: true });

		// DC open → HostWelcome 送信 + Phase 2 メディアネゴシエーション開始
		const assignmentCapture = assignment ?? null;
		commandChannel.onopen = () => {
			const welcome: HostWelcome = {
				type: 'host_welcome',
				hostProfile: this.hostProfile ?? undefined,
				videoQuality,
				controllerAssignment: assignmentCapture?.controllerId ?? null,
				playerNumber: assignmentCapture?.playerNumber ?? null,
			};
			commandChannel.send(JSON.stringify(welcome));
			// メディアストリームがあれば Phase 2 開始
			if (this.localStream) {
				this.startMediaNegotiation(userId);
			}
		};

		// DC 経由でゲストからのメッセージ受信
		commandChannel.onmessage = (msgEv) => {
			try {
				const msg = JSON.parse(msgEv.data as string);
				// Phase 2: ゲストからの media answer
				if (msg.type === 'media_answer') {
					this.handleMediaAnswer(userId, msg.sdp as string);
				}
			} catch {
				/* ignore */
			}
		};

		// ゲストが作成したデータチャネル受け取り
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
					if (msg.type === 'guest_introduce') {
						const session = this.sessions.get(userId);
						if (session) session.username = msg.profile.username;
						this.callbacks.onGuestProfile?.(userId, msg.profile);
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
			const session = this.sessions.get(userId);
			if (!session) return;
			session.connectionState = pc.connectionState;
			this.callbacks.onGuestStateChange?.(userId, pc.connectionState);
			if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
				this.disconnectGuest(userId);
			}
		};

		// Phase 1: メディアトラックは追加しない（SDP を小さく保つ）
		const session: GuestSession = {
			userId,
			username: '',
			guestBundle,
			pc,
			controllerChannel: null,
			commandChannel,
			connectionState: 'new',
			mediaReady: false,
			videoQuality,
		};
		this.sessions.set(userId, session);

		// Phase 1 の Offer/Answer
		await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
		const answer = await pc.createAnswer();
		await pc.setLocalDescription(answer);

		await waitForIceGathering(pc);

		const answerMsg: JoinAccepted = {
			type: 'join_accepted',
			answerSdp: pc.localDescription?.sdp ?? '',
		};

		await pushToBundle(guestBundle, answerMsg, 60);
	}

	/**
	 * Phase 2: メディアトラックを追加して DC 経由で再ネゴシエーション。
	 */
	private async startMediaNegotiation(userId: string): Promise<void> {
		const session = this.sessions.get(userId);
		if (!session || !this.localStream) return;
		if (session.mediaReady) return;

		const pc = session.pc;
		const stream = this.localStream;

		// トラック追加
		const senders = pc.getSenders();
		for (const track of stream.getTracks()) {
			if (!senders.find((s) => s.track?.kind === track.kind)) {
				pc.addTrack(track, stream);
			}
		}

		// 新しい Offer を生成して DC 経由で送信
		const offer = await pc.createOffer();
		await pc.setLocalDescription(offer);

		if (session.commandChannel?.readyState === 'open') {
			session.commandChannel.send(JSON.stringify({
				type: 'media_offer',
				sdp: pc.localDescription?.sdp ?? '',
			}));
		}
	}

	/**
	 * Phase 2: ゲストからのメディア answer を処理。
	 */
	private async handleMediaAnswer(userId: string, sdp: string): Promise<void> {
		const session = this.sessions.get(userId);
		if (!session) return;
		await session.pc.setRemoteDescription({ type: 'answer', sdp });
		session.mediaReady = true;

		// ビットレート制限
		if (session.videoQuality) {
			await applyBitrateLimit(session.pc, session.videoQuality);
		}
	}

	async setVideoQuality(userId: string, quality: string): Promise<void> {
		const session = this.sessions.get(userId);
		if (!session) return;
		await applyBitrateLimit(session.pc, quality);
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
			this.sessions.delete(userId);
			if (session.commandChannel?.readyState === 'open') {
				try {
					session.commandChannel.send(JSON.stringify({ type: 'host_disconnect' }));
				} catch {
					/* ignore */
				}
			}
			setTimeout(() => session.pc.close(), 100);
		}
	}

	disconnectAll(): void {
		const userIds = [...this.sessions.keys()];
		for (const userId of userIds) {
			this.disconnectGuest(userId);
		}
	}

	broadcastGuestList(): void {
		const allGuests: PeerInfo[] = [];
		for (const session of this.sessions.values()) {
			if (session.connectionState === 'connected') {
				allGuests.push({ userId: session.userId, username: session.username });
			}
		}
		for (const session of this.sessions.values()) {
			if (session.commandChannel?.readyState !== 'open') continue;
			const peers = allGuests.filter((g) => g.userId !== session.userId);
			const cmd: GuestListCommand = { type: 'guest_list', guests: peers };
			try {
				session.commandChannel.send(JSON.stringify(cmd));
			} catch { /* ignore */ }
		}
	}

	/** ゲストにコマンドを送信する。 */
	sendCommand(userId: string, cmd: object): void {
		const session = this.sessions.get(userId);
		if (session?.commandChannel?.readyState === 'open') {
			try {
				session.commandChannel.send(JSON.stringify(cmd));
			} catch { /* ignore */ }
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
		setTimeout(resolve, 5000);
	});
}
