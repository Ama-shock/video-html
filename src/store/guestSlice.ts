import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { PeerInfo } from '../webrtc/types';

export type GuestConnectionStatus =
	| 'idle'
	| 'joining'
	| 'waiting'
	| 'connected'
	| 'rejected'
	| 'error';

export type HostProfile = {
	userId: string; // ホストの Ed25519 公開鍵 base64url
	username: string;
};

type GuestState = {
	status: GuestConnectionStatus;
	roomKey: string; // 入力した部屋鍵
	hostStream: boolean; // ホストの映像を受信中か
	controllerId: number | null; // ホストから割り当てられたコントローラー ID
	hostProfile: HostProfile | null; // 接続先ホストの情報
	videoQuality: string | null; // ホストから通知された受信映像品質
	peers: PeerInfo[]; // 同室の他ゲスト
	error: string | null;
};

const initialState: GuestState = {
	status: 'idle',
	roomKey: '',
	hostStream: false,
	controllerId: null,
	hostProfile: null,
	videoQuality: null,
	peers: [],
	error: null,
};

const guestSlice = createSlice({
	name: 'guest',
	initialState,
	reducers: {
		setRoomKey(state, action: PayloadAction<string>) {
			state.roomKey = action.payload;
		},
		setStatus(state, action: PayloadAction<GuestConnectionStatus>) {
			state.status = action.payload;
			if (action.payload !== 'error') state.error = null;
		},
		setHostStream(state, action: PayloadAction<boolean>) {
			state.hostStream = action.payload;
		},
		setControllerAssignment(state, action: PayloadAction<number | null>) {
			state.controllerId = action.payload;
		},
		setHostProfile(state, action: PayloadAction<HostProfile | null>) {
			state.hostProfile = action.payload;
		},
		setVideoQuality(state, action: PayloadAction<string | null>) {
			state.videoQuality = action.payload;
		},
		setPeers(state, action: PayloadAction<PeerInfo[]>) {
			state.peers = action.payload;
		},
		setError(state, action: PayloadAction<string>) {
			state.status = 'error';
			state.error = action.payload;
		},
		reset(state) {
			state.status = 'idle';
			state.hostStream = false;
			state.controllerId = null;
			state.hostProfile = null;
			state.videoQuality = null;
			state.peers = [];
			state.error = null;
		},
	},
});

export const { setRoomKey, setStatus, setHostStream, setControllerAssignment, setHostProfile, setVideoQuality, setPeers, setError, reset } =
	guestSlice.actions;
export default guestSlice.reducer;
