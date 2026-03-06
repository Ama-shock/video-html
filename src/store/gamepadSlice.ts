import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { defaultKeymap, type KeymapEntry } from '../db/settings';

export type GamepadInfo = {
    index: number;
    id: string;
    connected: boolean;
    relayActive: boolean;
    relayControllerId: number | null;
};

type GamepadState = {
    gamepads: GamepadInfo[];
    keymap: KeymapEntry[];
};

const initialState: GamepadState = {
    gamepads: [],
    keymap: defaultKeymap(),
};

const gamepadSlice = createSlice({
    name: 'gamepad',
    initialState,
    reducers: {
        setGamepads(state, action: PayloadAction<GamepadInfo[]>) {
            state.gamepads = action.payload;
        },
        updateGamepad(state, action: PayloadAction<GamepadInfo>) {
            const idx = state.gamepads.findIndex(g => g.index === action.payload.index);
            if (idx >= 0) state.gamepads[idx] = action.payload;
            else state.gamepads.push(action.payload);
        },
        setRelayActive(state, action: PayloadAction<{ index: number; active: boolean; controllerId: number | null }>) {
            const gp = state.gamepads.find(g => g.index === action.payload.index);
            if (gp) {
                gp.relayActive = action.payload.active;
                gp.relayControllerId = action.payload.controllerId;
            }
        },
        setKeymap(state, action: PayloadAction<KeymapEntry[]>) {
            state.keymap = action.payload;
        },
    },
});

export const { setGamepads, updateGamepad, setRelayActive, setKeymap } = gamepadSlice.actions;
export default gamepadSlice.reducer;
