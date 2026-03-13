import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
	BtDevice,
	ConnectionMapEntry,
	Controller,
	DongleConnectionStatus,
	KnownDongle,
} from '../switchBtWs/types';

type DongleState = {
	devices: BtDevice[];
	controllers: Controller[];
	knownDongles: KnownDongle[];
	connectionMap: ConnectionMapEntry[];
	dongleStatuses: Record<string, DongleConnectionStatus>;
	/** リンクキーが IndexedDB に存在するドングルキーの集合 */
	linkKeysAvailable: Record<string, boolean>;
	/** ユーザーが手動切断したドングルキーの集合（自動再接続を抑止） */
	manuallyDisconnected: Record<string, boolean>;
	loading: boolean;
	error: string | null;
	driverBusy: boolean;
	version: string | null;
	initialized: boolean;
};

const initialState: DongleState = {
	devices: [],
	controllers: [],
	knownDongles: [],
	connectionMap: [],
	dongleStatuses: {},
	linkKeysAvailable: {},
	manuallyDisconnected: {},
	loading: false,
	error: null,
	driverBusy: false,
	version: null,
	initialized: false,
};

const dongleSlice = createSlice({
	name: 'dongle',
	initialState,
	reducers: {
		setDevices(state, action: PayloadAction<BtDevice[]>) {
			state.devices = action.payload;
		},
		setControllers(state, action: PayloadAction<Controller[]>) {
			state.controllers = action.payload;
		},
		setKnownDongles(state, action: PayloadAction<KnownDongle[]>) {
			state.knownDongles = action.payload;
		},
		setConnectionMap(state, action: PayloadAction<ConnectionMapEntry[]>) {
			state.connectionMap = action.payload;
		},
		setDongleStatus(state, action: PayloadAction<{ key: string; status: DongleConnectionStatus }>) {
			state.dongleStatuses[action.payload.key] = action.payload.status;
		},
		setLoading(state, action: PayloadAction<boolean>) {
			state.loading = action.payload;
		},
		setError(state, action: PayloadAction<string | null>) {
			state.error = action.payload;
		},
		setDriverBusy(state, action: PayloadAction<boolean>) {
			state.driverBusy = action.payload;
		},
		setVersion(state, action: PayloadAction<string | null>) {
			state.version = action.payload;
		},
		setLinkKeysAvailable(state, action: PayloadAction<{ key: string; available: boolean }>) {
			if (action.payload.available) {
				state.linkKeysAvailable[action.payload.key] = true;
			} else {
				delete state.linkKeysAvailable[action.payload.key];
			}
		},
		setManuallyDisconnected(state, action: PayloadAction<{ key: string; disconnected: boolean }>) {
			if (action.payload.disconnected) {
				state.manuallyDisconnected[action.payload.key] = true;
			} else {
				delete state.manuallyDisconnected[action.payload.key];
			}
		},
		setDongleInitialized(state) {
			state.initialized = true;
		},
		/** 個別コントローラーの状態を更新する（グローバル WS の controller_status 用） */
		updateControllerStatus(
			state,
			action: PayloadAction<{
				id: number;
				paired: boolean;
				rumble: boolean;
				syncing: boolean;
				player: number;
			}>,
		) {
			const idx = state.controllers.findIndex((c) => c.id === action.payload.id);
			if (idx >= 0) {
				Object.assign(state.controllers[idx], action.payload);
			}
		},
	},
});

export const {
	setDevices,
	setControllers,
	setKnownDongles,
	setConnectionMap,
	setDongleStatus,
	setLinkKeysAvailable,
	setManuallyDisconnected,
	setLoading,
	setError,
	setDriverBusy,
	setVersion,
	setDongleInitialized,
	updateControllerStatus,
} = dongleSlice.actions;
export default dongleSlice.reducer;
