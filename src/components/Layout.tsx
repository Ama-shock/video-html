import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '../store';
import { setActivePanel, setMode, type Panel, type AppMode } from '../store/appSlice';
import VideoView from './video/VideoView';
import HostPanel from './host/HostPanel';
import GuestPanel from './guest/GuestPanel';
import GamepadPanel from './gamepad/GamepadPanel';
import SettingsPanel from './settings/SettingsPanel';
import IdentityPanel from './identity/IdentityPanel';
import UserAvatar from './identity/UserAvatar';

const PANEL_LABELS: Record<Panel, string> = {
    video: '📺 映像',
    host: '🏠 ホスト',
    guest: '🎮 ゲスト',
    gamepad: '🕹 ゲームパッド',
    settings: '⚙ 設定',
    identity: '👤 プロフィール',
};

const MODE_LABELS: Record<AppMode, string> = {
    standalone: 'スタンドアロン',
    host: 'ホスト',
    guest: 'ゲスト',
};

export default function Layout() {
    const dispatch = useDispatch<AppDispatch>();
    const activePanel = useSelector((s: RootState) => s.app.activePanel);
    const mode = useSelector((s: RootState) => s.app.mode);

    const panels: Panel[] = ['video', 'gamepad', 'host', 'guest', 'settings', 'identity'];

    return (
        <div className="layout">
            <nav className="sidebar">
                <div className="sidebar-brand">
                    <span className="brand-text">VidCapt</span>
                    <UserAvatar size={32} />
                </div>

                <div className="mode-switcher">
                    {(['standalone', 'host', 'guest'] as AppMode[]).map(m => (
                        <button
                            key={m}
                            className={`mode-btn ${mode === m ? 'active' : ''}`}
                            onClick={() => dispatch(setMode(m))}
                        >
                            {MODE_LABELS[m]}
                        </button>
                    ))}
                </div>

                <ul className="nav-list">
                    {panels.map(panel => (
                        <li key={panel}>
                            <button
                                className={`nav-btn ${activePanel === panel ? 'active' : ''}`}
                                onClick={() => dispatch(setActivePanel(panel))}
                            >
                                {PANEL_LABELS[panel]}
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>

            <main className="content">
                {activePanel === 'video' && <VideoView />}
                {activePanel === 'host' && <HostPanel />}
                {activePanel === 'guest' && <GuestPanel />}
                {activePanel === 'gamepad' && <GamepadPanel />}
                {activePanel === 'settings' && <SettingsPanel />}
                {activePanel === 'identity' && <IdentityPanel />}
            </main>
        </div>
    );
}
