import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type AppMode = 'host' | 'guest';
export type MenuSection = 'video' | 'host' | 'guest' | 'gamepad' | 'identity';

type AppState = {
	mode: AppMode;
	menuOpen: boolean;
	menuSection: MenuSection;
	videoDeviceId: string | null;
	audioDeviceId: string | null;
	videoWidth: number;
	videoHeight: number;
	switchBtWsPort: number;
	initialized: boolean;
};

const initialState: AppState = {
	mode: 'host',
	menuOpen: true,
	menuSection: 'video',
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
			// モード切替時にデフォルトのセクションを設定
			state.menuSection = action.payload === 'guest' ? 'guest' : 'video';
		},
		setMenuOpen(state, action: PayloadAction<boolean>) {
			state.menuOpen = action.payload;
		},
		toggleMenu(state) {
			state.menuOpen = !state.menuOpen;
		},
		setMenuSection(state, action: PayloadAction<MenuSection>) {
			state.menuSection = action.payload;
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
	setMenuOpen,
	toggleMenu,
	setMenuSection,
	setVideoDevice,
	setAudioDevice,
	setResolution,
	setSwitchBtWsPort,
	setInitialized,
} = appSlice.actions;

export default appSlice.reducer;
