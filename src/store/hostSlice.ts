import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type GuestStatus = {
    userId: string;
    username: string;
    connectionState: RTCPeerConnectionState;
    allowed: boolean;
    controllerId: number | null;
};

export type RoomStatus = 'closed' | 'open';

type HostState = {
    roomStatus: RoomStatus;
    roomKey: string | null;         // base64url クレデンシャルバンドル
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
            const idx = state.pendingRequests.findIndex(g => g.userId === action.payload.userId);
            if (idx >= 0) state.pendingRequests[idx] = action.payload;
            else state.pendingRequests.push(action.payload);
        },
        allowGuest(state, action: PayloadAction<{ userId: string; controllerId: number | null }>) {
            const pending = state.pendingRequests.find(g => g.userId === action.payload.userId);
            if (pending) {
                state.pendingRequests = state.pendingRequests.filter(g => g.userId !== action.payload.userId);
                const guest: GuestStatus = {
                    ...pending,
                    allowed: true,
                    controllerId: action.payload.controllerId,
                };
                state.guests.push(guest);
            }
        },
        rejectGuest(state, action: PayloadAction<string>) {
            state.pendingRequests = state.pendingRequests.filter(g => g.userId !== action.payload);
        },
        removeGuest(state, action: PayloadAction<string>) {
            state.guests = state.guests.filter(g => g.userId !== action.payload);
        },
        updateGuestConnection(state, action: PayloadAction<{ userId: string; connectionState: RTCPeerConnectionState }>) {
            const guest = state.guests.find(g => g.userId === action.payload.userId);
            if (guest) guest.connectionState = action.payload.connectionState;
        },
        setGuestController(state, action: PayloadAction<{ userId: string; controllerId: number | null }>) {
            const guest = state.guests.find(g => g.userId === action.payload.userId);
            if (guest) guest.controllerId = action.payload.controllerId;
        },
    },
});

export const {
    openRoom, closeRoom, addPendingGuest, allowGuest, rejectGuest,
    removeGuest, updateGuestConnection, setGuestController,
} = hostSlice.actions;
export default hostSlice.reducer;
