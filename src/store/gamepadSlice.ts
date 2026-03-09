import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { defaultKeymap, type KeymapEntry } from '../db/settings';
import type { KeyboardKeymapEntry } from '../keyboard/index';
import { defaultKeyboardKeymap } from '../keyboard/keymap';

export type GamepadInfo = {
	index: number;
	id: string;
	connected: boolean;
	relayActive: boolean;
	relayControllerId: number | null;
};

type GamepadSliceState = {
	gamepads: GamepadInfo[];
	keymap: KeymapEntry[];
	keyboardKeymap: KeyboardKeymapEntry[];
	keyboardConnected: boolean;
	keyboardRelayActive: boolean;
	keyboardRelayControllerId: number | null;
};

const initialState: GamepadSliceState = {
	gamepads: [],
	keymap: defaultKeymap(),
	keyboardKeymap: defaultKeyboardKeymap(),
	keyboardConnected: true,
	keyboardRelayActive: false,
	keyboardRelayControllerId: null,
};

const gamepadSlice = createSlice({
	name: 'gamepad',
	initialState,
	reducers: {
		setGamepads(state, action: PayloadAction<GamepadInfo[]>) {
			state.gamepads = action.payload;
		},
		updateGamepad(state, action: PayloadAction<GamepadInfo>) {
			const idx = state.gamepads.findIndex((g) => g.index === action.payload.index);
			if (idx >= 0) state.gamepads[idx] = action.payload;
			else state.gamepads.push(action.payload);
		},
		setRelayActive(
			state,
			action: PayloadAction<{ index: number; active: boolean; controllerId: number | null }>,
		) {
			const gp = state.gamepads.find((g) => g.index === action.payload.index);
			if (gp) {
				gp.relayActive = action.payload.active;
				gp.relayControllerId = action.payload.controllerId;
			}
		},
		setKeymap(state, action: PayloadAction<KeymapEntry[]>) {
			state.keymap = action.payload;
		},
		setKeyboardKeymap(state, action: PayloadAction<KeyboardKeymapEntry[]>) {
			state.keyboardKeymap = action.payload;
		},
		setKeyboardRelayActive(
			state,
			action: PayloadAction<{ active: boolean; controllerId: number | null }>,
		) {
			state.keyboardRelayActive = action.payload.active;
			state.keyboardRelayControllerId = action.payload.controllerId;
		},
	},
});

export const {
	setGamepads,
	updateGamepad,
	setRelayActive,
	setKeymap,
	setKeyboardKeymap,
	setKeyboardRelayActive,
} = gamepadSlice.actions;
export default gamepadSlice.reducer;
