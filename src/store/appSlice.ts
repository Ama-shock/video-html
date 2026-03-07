import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type AppMode = 'standalone' | 'host' | 'guest';
export type Panel = 'video' | 'host' | 'guest' | 'gamepad' | 'settings' | 'identity';

type AppState = {
	mode: AppMode;
	activePanel: Panel;
	videoDeviceId: string | null;
	audioDeviceId: string | null;
	videoWidth: number;
	videoHeight: number;
	switchBtWsPort: number;
	initialized: boolean;
};

const initialState: AppState = {
	mode: 'standalone',
	activePanel: 'video',
	videoDeviceId: null,
	audioDeviceId: null,
	videoWidth: 1920,
	videoHeight: 1080,
	switchBtWsPort: 8765,
	initialized: false,
};

const appSlice = createSlice({
	name: 'app',
	initialState,
	reducers: {
		setMode(state, action: PayloadAction<AppMode>) {
			state.mode = action.payload;
		},
		setActivePanel(state, action: PayloadAction<Panel>) {
			state.activePanel = action.payload;
		},
		setVideoDevice(state, action: PayloadAction<string | null>) {
			state.videoDeviceId = action.payload;
		},
		setAudioDevice(state, action: PayloadAction<string | null>) {
			state.audioDeviceId = action.payload;
		},
		setResolution(state, action: PayloadAction<{ width: number; height: number }>) {
			state.videoWidth = action.payload.width;
			state.videoHeight = action.payload.height;
		},
		setSwitchBtWsPort(state, action: PayloadAction<number>) {
			state.switchBtWsPort = action.payload;
		},
		setInitialized(state) {
			state.initialized = true;
		},
	},
});

export const {
	setMode,
	setActivePanel,
	setVideoDevice,
	setAudioDevice,
	setResolution,
	setSwitchBtWsPort,
	setInitialized,
} = appSlice.actions;

export default appSlice.reducer;
