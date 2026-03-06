import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '../../store';
import {
    openRoom, closeRoom, addPendingGuest, allowGuest, rejectGuest,
    removeGuest, updateGuestConnection, setGuestController,
} from '../../store/hostSlice';
import { fetchGatewayInfo, createRoomKey, pushToBundle } from '../../webpush/gateway';
import { subscribeToPush } from '../../webpush/subscription';
import { HostWebRTC } from '../../webrtc/host';
import type { JoinRequest, JoinAccepted } from '../../webrtc/types';
import { listGuests, saveGuest, loadGuest } from '../../db/guestRegistry';
import RoomKeyDisplay from './RoomKeyDisplay';
import GuestList from './GuestList';

export default function HostPanel() {
    const dispatch = useDispatch<AppDispatch>();
    const mode = useSelector((s: RootState) => s.app.mode);
    const roomStatus = useSelector((s: RootState) => s.host.roomStatus);
    const roomKey = useSelector((s: RootState) => s.host.roomKey);
    const guests = useSelector((s: RootState) => s.host.guests);
    const pendingRequests = useSelector((s: RootState) => s.host.pendingRequests);
    const gatewayUrl = useSelector((s: RootState) => s.app.gatewayUrl);
    const publicKeyB64 = useSelector((s: RootState) => s.identity.publicKeyB64);

    const [validHours, setValidHours] = useState(12);
    const [error, setError] = useState<string | null>(null);
    const hostRtcRef = useRef<HostWebRTC | null>(null);

    if (mode !== 'host') {
        return (
            <div className="panel">
                <h2>ホストパネル</h2>
                <p>上部のモード切替で「ホスト」を選択してください。</p>
            </div>
        );
    }

    const handleOpenRoom = async () => {
        setError(null);
        try {
            const swReg = await navigator.serviceWorker.getRegistration();
            if (!swReg) throw new Error('Service worker が登録されていません');

            const gateway = await fetchGatewayInfo(gatewayUrl);
            const sub = await subscribeToPush(gatewayUrl, swReg);
            const expirationSec = Math.floor(Date.now() / 1000) + validHours * 3600;
            const key = await createRoomKey(sub, gateway, validHours * 3600);

            dispatch(openRoom({ roomKey: key, expiresAt: expirationSec }));

            // WebRTC ホスト初期化
            hostRtcRef.current = new HostWebRTC(gatewayUrl, {
                onGuestStateChange: (userId, state) => {
                    dispatch(updateGuestConnection({ userId, connectionState: state }));
                },
                onControllerInput: (userId, input) => {
                    // ゲストのコントローラー入力をリレー (switch-bt-ws へ転送)
                    const guest = guests.find(g => g.userId === userId);
                    if (guest?.controllerId != null) {
                        // TODO: switch-bt-ws へ転送
                    }
                },
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleCloseRoom = () => {
        hostRtcRef.current?.disconnectAll();
        hostRtcRef.current = null;
        dispatch(closeRoom());
    };

    const handleAllowGuest = async (userId: string, controllerId: number | null) => {
        dispatch(allowGuest({ userId, controllerId }));

        const pending = pendingRequests.find(g => g.userId === userId);
        if (!pending) return;

        // DB に保存
        const existing = await loadGuest(userId);
        await saveGuest({
            userId,
            username: pending.username,
            allowed: true,
            controllerId,
            lastSeen: new Date().toISOString(),
        });
    };

    const handleRejectGuest = (userId: string) => {
        dispatch(rejectGuest(userId));
    };

    const handleRemoveGuest = (userId: string) => {
        hostRtcRef.current?.disconnectGuest(userId);
        dispatch(removeGuest(userId));
    };

    // WebPush メッセージ受信 (サービスワーカーからのメッセージ)
    useEffect(() => {
        const handleMessage = async (ev: MessageEvent) => {
            const data = ev.data as { type?: string; payload?: unknown };
            if (data.type !== 'push_received') return;
            const msg = data.payload as { type: string };

            if (msg.type === 'join_request') {
                const req = msg as unknown as JoinRequest;
                dispatch(addPendingGuest({
                    userId: req.profile.userId,
                    username: req.profile.username,
                    connectionState: 'new',
                    allowed: false,
                    controllerId: null,
                }));
                // 自動許可: DB に許可済みレコードがあれば自動承認
                const existing = await loadGuest(req.profile.userId);
                if (existing?.allowed) {
                    await hostRtcRef.current?.handleJoinRequest(req);
                    dispatch(allowGuest({ userId: req.profile.userId, controllerId: existing.controllerId }));
                }
            }
        };

        navigator.serviceWorker.addEventListener('message', handleMessage);
        return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
    }, [dispatch, pendingRequests]);

    return (
        <div className="panel host-panel">
            <h2>ホストパネル</h2>

            {error && <div className="error-msg">{error}</div>}

            {roomStatus === 'closed' ? (
                <div className="room-setup">
                    <h3>部屋を開始</h3>
                    <div className="form-group">
                        <label>部屋鍵有効期間</label>
                        <select value={validHours} onChange={e => setValidHours(Number(e.target.value))}>
                            {[1, 2, 4, 8, 12, 24].map(h => (
                                <option key={h} value={h}>{h}時間</option>
                            ))}
                        </select>
                    </div>
                    <button className="btn btn-primary" onClick={handleOpenRoom}>
                        部屋を開く
                    </button>
                </div>
            ) : (
                <>
                    <div className="room-active">
                        <div className="room-status-badge">🟢 部屋開放中</div>
                        <RoomKeyDisplay roomKey={roomKey!} />
                        <button className="btn btn-danger" onClick={handleCloseRoom}>
                            部屋を閉じる
                        </button>
                    </div>

                    <GuestList
                        pending={pendingRequests}
                        guests={guests}
                        onAllow={handleAllowGuest}
                        onReject={handleRejectGuest}
                        onRemove={handleRemoveGuest}
                        onSetController={(userId, cid) => dispatch(setGuestController({ userId, controllerId: cid }))}
                    />
                </>
            )}
        </div>
    );
}
