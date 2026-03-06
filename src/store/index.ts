import { configureStore } from '@reduxjs/toolkit';
import appReducer from './appSlice';
import identityReducer from './identitySlice';
import hostReducer from './hostSlice';
import guestReducer from './guestSlice';
import gamepadReducer from './gamepadSlice';

export const store = configureStore({
    reducer: {
        app: appReducer,
        identity: identityReducer,
        host: hostReducer,
        guest: guestReducer,
        gamepad: gamepadReducer,
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
