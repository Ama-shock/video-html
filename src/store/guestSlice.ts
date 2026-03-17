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

export type SelectedDevice = { type: 'gamepad'; index: number } | { type: 'keyboard' } | null;

type GuestState = {
	status: GuestConnectionStatus;
	statusDetail: string | null; // 接続進行中の詳細ステータス
	roomKey: string; // 入力した部屋鍵
	hostStream: boolean; // ホストの映像を受信中か
	controllerId: number | null; // ホストから割り当てられたコントローラー ID
	playerNumber: number | null; // P1〜P4 のプレイヤー番号
	hostProfile: HostProfile | null; // 接続先ホストの情報
	videoQuality: string | null; // ホストから通知された受信映像品質
	peers: PeerInfo[]; // 同室の他ゲスト
	error: string | null;
	selectedDevice: SelectedDevice; // ホストに送信する入力デバイス
};

const initialState: GuestState = {
	status: 'idle',
	statusDetail: null,
	roomKey: '',
	hostStream: false,
	controllerId: null,
	playerNumber: null,
	hostProfile: null,
	videoQuality: null,
	peers: [],
	error: null,
	selectedDevice: null,
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
			if (action.payload === 'connected' || action.payload === 'idle') state.statusDetail = null;
		},
		setStatusDetail(state, action: PayloadAction<string | null>) {
			state.statusDetail = action.payload;
		},
		setHostStream(state, action: PayloadAction<boolean>) {
			state.hostStream = action.payload;
		},
		setControllerAssignment(state, action: PayloadAction<{ controllerId: number | null; playerNumber: number | null }>) {
			state.controllerId = action.payload.controllerId;
			state.playerNumber = action.payload.playerNumber;
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
		setSelectedDevice(state, action: PayloadAction<SelectedDevice>) {
			state.selectedDevice = action.payload;
		},
		setError(state, action: PayloadAction<string>) {
			state.status = 'error';
			state.error = action.payload;
		},
		reset(state) {
			state.status = 'idle';
			state.statusDetail = null;
			state.hostStream = false;
			state.controllerId = null;
			state.playerNumber = null;
			state.hostProfile = null;
			state.videoQuality = null;
			state.peers = [];
			state.error = null;
			state.selectedDevice = null;
		},
	},
});

export const { setRoomKey, setStatus, setStatusDetail, setHostStream, setControllerAssignment, setHostProfile, setVideoQuality, setPeers, setSelectedDevice, setError, reset } =
	guestSlice.actions;
export default guestSlice.reducer;
