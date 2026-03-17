import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { unlockAudio } from '../../audio/unlock';
import { getOrCreateIdentity } from '../../identity';
import { generateIdenticonDataUrl } from '../../identity/identicon';
import type { AppDispatch, RootState } from '../../store';
import {
	reset,
	setControllerAssignment,
	setError,
	setHostProfile,
	setPeers,
	setRoomKey,
	setStatus,
	setStatusDetail,
	setVideoQuality,
} from '../../store/guestSlice';
import { VIDEO_QUALITY_LABELS, type VideoQuality } from '../../store/hostSlice';
import { ensurePushReady } from '../../webpush/ensureReady';
import { createRoomKey, fetchGatewayInfo, validateRoomKeyFormat } from '../../webpush/gateway';
import { subscribeToPush } from '../../webpush/subscription';
import { GuestWebRTC } from '../../webrtc/guest';
import { getGuestRtc, setGuestRtc } from '../../webrtc/guestConnection';

/**
 * Guest menu section in the overlay.
 * Contains room key input form, connection status, and host info.
 */
export default function GuestMenu() {
	const dispatch = useDispatch<AppDispatch>();
	const status = useSelector((s: RootState) => s.guest.status);
	const statusDetail = useSelector((s: RootState) => s.guest.statusDetail);
	const controllerId = useSelector((s: RootState) => s.guest.controllerId);
	const playerNumber = useSelector((s: RootState) => s.guest.playerNumber);
	const hostProfile = useSelector((s: RootState) => s.guest.hostProfile);
	const videoQuality = useSelector((s: RootState) => s.guest.videoQuality);
	const peers = useSelector((s: RootState) => s.guest.peers);
	const error = useSelector((s: RootState) => s.guest.error);
	const username = useSelector((s: RootState) => s.identity.username);

	const [inputKey, setInputKey] = useState('');
	const [hostAvatar, setHostAvatar] = useState<string | null>(null);
	const [rttMs, setRttMs] = useState<number | null>(null);

	// 接続中は RTT を定期取得
	useEffect(() => {
		if (status !== 'connected') {
			setRttMs(null);
			return;
		}
		const poll = async () => {
			const rtc = getGuestRtc();
			const stats = await rtc?.getStats();
			setRttMs(stats?.rttMs ?? null);
		};
		poll();
		const id = setInterval(poll, 2000);
		return () => clearInterval(id);
	}, [status]);

	// URL hash から部屋鍵を取得し、hash を消す + hashchange を監視
	useEffect(() => {
		const applyRoomFromHash = () => {
			const hash = new URLSearchParams(window.location.hash.slice(1));
			const key = hash.get('room');
			if (key) {
				const decoded = decodeURIComponent(key);
				setInputKey(decoded);
				dispatch(setRoomKey(decoded));
				// hash を履歴に残さず消す
				history.replaceState(null, '', window.location.pathname + window.location.search);
			}
		};
		applyRoomFromHash();
		window.addEventListener('hashchange', applyRoomFromHash);
		return () => window.removeEventListener('hashchange', applyRoomFromHash);
	}, [dispatch]);

	// ホストアバター生成
	useEffect(() => {
		if (hostProfile?.userId) {
			generateIdenticonDataUrl(hostProfile.userId).then(setHostAvatar);
		} else {
			setHostAvatar(null);
		}
	}, [hostProfile?.userId]);

	const handleJoin = async () => {
		// ユーザー操作コンテキストで音声出力を許可（autoplay policy 対策）
		unlockAudio();
		const key = inputKey.trim();
		if (!validateRoomKeyFormat(key)) {
			dispatch(setError('無効な部屋鍵です'));
			return;
		}
		dispatch(setRoomKey(key));
		dispatch(setStatus('joining'));
		try {
			dispatch(setStatusDetail('Push 通知を準備中...'));
			const swReg = await ensurePushReady();
			dispatch(setStatusDetail('ゲートウェイ情報を取得中...'));
			const gateway = await fetchGatewayInfo();
			const sub = await subscribeToPush(swReg);
			const guestBundle = await createRoomKey(sub, gateway, 3600);
			const identity = await getOrCreateIdentity();
			const rtc = new GuestWebRTC({
				onProgress: (detail) => dispatch(setStatusDetail(detail)),
				onConnectionState: (state) => {
					if (state === 'connected') dispatch(setStatus('connected'));
					else if (state === 'failed' || state === 'closed') {
						setGuestRtc(null);
						dispatch(reset());
					}
				},
				onControllerAssignment: (cid) => {
					dispatch(setControllerAssignment({ controllerId: cid, playerNumber: null }));
				},
				onHostCommand: (cmd) => {
					if (cmd.type === 'host_welcome') {
						const hp = cmd.hostProfile as { userId: string; username: string } | undefined;
						if (hp) dispatch(setHostProfile(hp));
						if (typeof cmd.videoQuality === 'string') dispatch(setVideoQuality(cmd.videoQuality));
						if (typeof cmd.controllerAssignment === 'number') {
							const pn = typeof cmd.playerNumber === 'number' ? cmd.playerNumber : null;
							dispatch(setControllerAssignment({ controllerId: cmd.controllerAssignment, playerNumber: pn }));
						}
					} else if (cmd.type === 'controller_assignment') {
						dispatch(setControllerAssignment({
							controllerId: typeof cmd.controllerId === 'number' ? cmd.controllerId : null,
							playerNumber: typeof cmd.playerNumber === 'number' ? cmd.playerNumber : null,
						}));
					} else if (cmd.type === 'quality_change' && typeof cmd.videoQuality === 'string') {
						dispatch(setVideoQuality(cmd.videoQuality));
					} else if (cmd.type === 'guest_list' && Array.isArray(cmd.guests)) {
						dispatch(setPeers(cmd.guests as { userId: string; username: string }[]));
					}
				},
			});
			setGuestRtc(rtc);
			await rtc.join(key, guestBundle, identity, username);
			dispatch(setStatus('waiting'));
		} catch (err) {
			dispatch(setError(err instanceof Error ? err.message : String(err)));
		}
	};

	const handleLeave = () => {
		setGuestRtc(null);
		dispatch(reset());
	};

	return (
		<div className="menu-section">
			<h3>ゲスト接続</h3>

			{error && <div className="error-msg">{error}</div>}

			{/* 部屋鍵入力 (idle / error) */}
			{(status === 'idle' || status === 'error') && (
				<div className="menu-card">
					<div className="form-group">
						<label>
							部屋鍵
							<textarea
								value={inputKey}
								onChange={(e) => setInputKey(e.target.value)}
								placeholder="ホストから受け取った部屋鍵を貼り付けてください"
								rows={4}
							/>
						</label>
					</div>
					<button
						type="button"
						className="btn btn-primary"
						onClick={handleJoin}
						disabled={!inputKey.trim()}
					>
						入室する
					</button>
				</div>
			)}

			{/* 接続中 */}
			{status === 'joining' && (
				<div className="menu-card">
					<div className="guest-connection-status">
						<span className="status-dot waiting" />
						<span>接続中...</span>
					</div>
					{statusDetail && <p className="hint">{statusDetail}</p>}
				</div>
			)}

			{/* 承認待ち */}
			{status === 'waiting' && (
				<div className="menu-card">
					<div className="guest-connection-status">
						<span className="status-dot waiting" />
						<span>ホストの承認待ち</span>
					</div>
					{statusDetail && <p className="hint">{statusDetail}</p>}
					<button type="button" className="btn btn-danger btn-sm" onClick={handleLeave}>
						キャンセル
					</button>
				</div>
			)}

			{/* 接続済み */}
			{status === 'connected' && (
				<div className="menu-card">
					<div className="guest-connection-status">
						<span className="status-dot connected" />
						<span>接続中</span>
						{rttMs !== null && (
							<span className="rtt-badge">{rttMs} ms</span>
						)}
					</div>
					{controllerId !== null && (
						<p className="hint">
							{playerNumber ? `P${playerNumber}` : `コントローラー #${controllerId}`} として接続中
						</p>
					)}
					<button type="button" className="btn btn-danger btn-sm" onClick={handleLeave}>
						切断
					</button>
				</div>
			)}

			{/* 拒否 */}
			{status === 'rejected' && (
				<div className="menu-card">
					<div className="guest-connection-status">
						<span className="status-dot" />
						<span>接続が拒否されました</span>
					</div>
					<button type="button" className="btn btn-secondary btn-sm" onClick={handleLeave}>
						戻る
					</button>
				</div>
			)}

			{/* ホスト情報 */}
			{hostProfile && (
				<div className="menu-card">
					<h4>接続先ホスト</h4>
					<div className="host-profile-info">
						{hostAvatar && (
							<img src={hostAvatar} alt="" className="host-avatar" width={36} height={36} />
						)}
						<div className="host-profile-detail">
							<span className="host-username">{hostProfile.username}</span>
							<span className="host-userid">{hostProfile.userId.slice(0, 12)}…</span>
						</div>
					</div>
					{videoQuality && (
						<p className="hint">
							受信映像品質: {VIDEO_QUALITY_LABELS[videoQuality as VideoQuality] ?? videoQuality}
						</p>
					)}
				</div>
			)}

			{/* 同室ゲスト */}
			{status === 'connected' && (
				<div className="menu-card">
					<h4>同室のゲスト ({peers.length})</h4>
					{peers.length === 0 ? (
						<p className="empty-msg">他のゲストはいません</p>
					) : (
						<div className="peer-list">
							{peers.map((p) => (
								<PeerCard key={p.userId} userId={p.userId} username={p.username} />
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function PeerCard({ userId, username }: { userId: string; username: string }) {
	const [avatar, setAvatar] = useState<string | null>(null);
	useEffect(() => {
		generateIdenticonDataUrl(userId).then(setAvatar);
	}, [userId]);
	return (
		<div className="peer-card">
			{avatar && <img src={avatar} alt="" className="peer-avatar" width={28} height={28} />}
			<div className="peer-info">
				<span className="peer-name">{username}</span>
				<span className="peer-id">{userId.slice(0, 12)}…</span>
			</div>
		</div>
	);
}
