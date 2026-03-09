import { configureStore } from '@reduxjs/toolkit';
import appReducer from './appSlice';
import dongleReducer from './dongleSlice';
import gamepadReducer from './gamepadSlice';
import guestReducer from './guestSlice';
import hostReducer from './hostSlice';
import identityReducer from './identitySlice';

export const store = configureStore({
	reducer: {
		app: appReducer,
		identity: identityReducer,
		host: hostReducer,
		guest: guestReducer,
		gamepad: gamepadReducer,
		dongle: dongleReducer,
	},
	middleware: (getDefaultMiddleware) =>
		getDefaultMiddleware({
			// CryptoKey は plain object ではないためシリアライズ非対象に
			serializableCheck: {
				ignoredPaths: ['identity.privateKey'],
				ignoredActions: ['identity/setIdentity'],
			},
		}),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
