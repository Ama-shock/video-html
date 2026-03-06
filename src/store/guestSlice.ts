import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type GuestConnectionStatus = 'idle' | 'joining' | 'waiting' | 'connected' | 'rejected' | 'error';

type GuestState = {
    status: GuestConnectionStatus;
    roomKey: string;             // 入力した部屋鍵
    hostStream: boolean;         // ホストの映像を受信中か
    controllerId: number | null; // ホストから割り当てられたコントローラー ID
    error: string | null;
};

const initialState: GuestState = {
    status: 'idle',
    roomKey: '',
    hostStream: false,
    controllerId: null,
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
        setError(state, action: PayloadAction<string>) {
            state.status = 'error';
            state.error = action.payload;
        },
        reset(state) {
            state.status = 'idle';
            state.hostStream = false;
            state.controllerId = null;
            state.error = null;
        },
    },
});

export const { setRoomKey, setStatus, setHostStream, setControllerAssignment, setError, reset } = guestSlice.actions;
export default guestSlice.reducer;
