import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type VideoQuality = 'high' | 'medium' | 'low';

export const VIDEO_QUALITY_LABELS: Record<VideoQuality, string> = {
	high: '高画質 (1080p)',
	medium: '標準 (720p)',
	low: '低画質 (480p)',
};

export type GuestStatus = {
	userId: string;
	username: string;
	connectionState: RTCPeerConnectionState;
	allowed: boolean;
	controllerId: number | null;
	videoQuality: VideoQuality;
};

export type RoomStatus = 'closed' | 'open';

type HostState = {
	roomStatus: RoomStatus;
	roomKey: string | null; // base64url クレデンシャルバンドル
	roomKeyExpiresAt: number | null; // Unix timestamp (秒)
	guests: GuestStatus[];
	pendingRequests: GuestStatus[]; // 許可待ちのゲスト
};

const initialState: HostState = {
	roomStatus: 'closed',
	roomKey: null,
	roomKeyExpiresAt: null,
	guests: [],
	pendingRequests: [],
};

const hostSlice = createSlice({
	name: 'host',
	initialState,
	reducers: {
		openRoom(state, action: PayloadAction<{ roomKey: string; expiresAt: number }>) {
			state.roomStatus = 'open';
			state.roomKey = action.payload.roomKey;
			state.roomKeyExpiresAt = action.payload.expiresAt;
		},
		closeRoom(state) {
			state.roomStatus = 'closed';
			state.roomKey = null;
			state.roomKeyExpiresAt = null;
			state.guests = [];
			state.pendingRequests = [];
		},
		addPendingGuest(state, action: PayloadAction<GuestStatus>) {
			// 再接続の場合、既存の guests エントリを除去
			state.guests = state.guests.filter((g) => g.userId !== action.payload.userId);
			const idx = state.pendingRequests.findIndex((g) => g.userId === action.payload.userId);
			if (idx >= 0) state.pendingRequests[idx] = action.payload;
			else state.pendingRequests.push(action.payload);
		},
		allowGuest(state, action: PayloadAction<{ userId: string; controllerId: number | null }>) {
			const pending = state.pendingRequests.find((g) => g.userId === action.payload.userId);
			if (pending) {
				state.pendingRequests = state.pendingRequests.filter(
					(g) => g.userId !== action.payload.userId,
				);
				// 同一ユーザーの既存エントリを除去して重複防止
				state.guests = state.guests.filter((g) => g.userId !== action.payload.userId);
				const guest: GuestStatus = {
					...pending,
					allowed: true,
					controllerId: action.payload.controllerId,
					videoQuality: pending.videoQuality ?? 'high',
				};
				state.guests.push(guest);
			}
		},
		rejectGuest(state, action: PayloadAction<string>) {
			state.pendingRequests = state.pendingRequests.filter((g) => g.userId !== action.payload);
		},
		removeGuest(state, action: PayloadAction<string>) {
			state.guests = state.guests.filter((g) => g.userId !== action.payload);
		},
		updateGuestConnection(
			state,
			action: PayloadAction<{ userId: string; connectionState: RTCPeerConnectionState }>,
		) {
			const guest = state.guests.find((g) => g.userId === action.payload.userId);
			if (guest) guest.connectionState = action.payload.connectionState;
		},
		setGuestController(
			state,
			action: PayloadAction<{ userId: string; controllerId: number | null }>,
		) {
			const guest = state.guests.find((g) => g.userId === action.payload.userId);
			if (guest) guest.controllerId = action.payload.controllerId;
		},
		setGuestVideoQuality(
			state,
			action: PayloadAction<{ userId: string; videoQuality: VideoQuality }>,
		) {
			const guest = state.guests.find((g) => g.userId === action.payload.userId);
			if (guest) guest.videoQuality = action.payload.videoQuality;
		},
	},
});

export const {
	openRoom,
	closeRoom,
	addPendingGuest,
	allowGuest,
	rejectGuest,
	removeGuest,
	updateGuestConnection,
	setGuestController,
	setGuestVideoQuality,
} = hostSlice.actions;
export default hostSlice.reducer;
