import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

type IdentityState = {
	loaded: boolean;
	publicKeyB64: string | null;
	username: string;
	// privateKey は Redux 外 (identity モジュール) で管理
};

const initialState: IdentityState = {
	loaded: false,
	publicKeyB64: null,
	username: '',
};

const identitySlice = createSlice({
	name: 'identity',
	initialState,
	reducers: {
		setIdentity(state, action: PayloadAction<{ publicKeyB64: string; username: string }>) {
			state.loaded = true;
			state.publicKeyB64 = action.payload.publicKeyB64;
			state.username = action.payload.username;
		},
		setUsername(state, action: PayloadAction<string>) {
			state.username = action.payload;
		},
		clearIdentity(state) {
			state.loaded = false;
			state.publicKeyB64 = null;
			state.username = '';
		},
	},
});

export const { setIdentity, setUsername, clearIdentity } = identitySlice.actions;
export default identitySlice.reducer;
