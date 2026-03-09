import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../../store';
import { type AppMode, type MenuSection, setMenuOpen, setMenuSection, setMode } from '../../store/appSlice';
import UserAvatar from '../identity/UserAvatar';
import GamepadMenu from './GamepadMenu';
import GuestMenu from './GuestMenu';
import HostMenu from './HostMenu';
import IdentityMenu from './IdentityMenu';
import VideoMenu from './VideoMenu';

const MODE_LABELS: Record<AppMode, string> = {
	host: 'ホスト',
	guest: 'ゲスト',
};

type SectionDef = { key: MenuSection; label: string };

const SECTIONS_BY_MODE: Record<AppMode, SectionDef[]> = {
	host: [
		{ key: 'video', label: '映像' },
		{ key: 'host', label: 'ホスト管理' },
		{ key: 'gamepad', label: 'ゲームパッド' },
		{ key: 'identity', label: 'プロフィール' },
	],
	guest: [
		{ key: 'video', label: '映像' },
		{ key: 'guest', label: 'ゲスト接続' },
		{ key: 'gamepad', label: 'ゲームパッド' },
		{ key: 'identity', label: 'プロフィール' },
	],
};

export default function OverlayMenu() {
	const dispatch = useDispatch<AppDispatch>();
	const menuOpen = useSelector((s: RootState) => s.app.menuOpen);
	const menuSection = useSelector((s: RootState) => s.app.menuSection);
	const mode = useSelector((s: RootState) => s.app.mode);
	const streaming = useSelector((s: RootState) => s.app.streaming);
	const roomStatus = useSelector((s: RootState) => s.host.roomStatus);
	const guestStatus = useSelector((s: RootState) => s.guest.status);

	// 映像配信中・部屋開放中・ゲスト接続中はモード切替を無効化
	const modeLocked = streaming
		|| roomStatus !== 'closed'
		|| (guestStatus !== 'idle' && guestStatus !== 'rejected' && guestStatus !== 'error');

	const sections = SECTIONS_BY_MODE[mode];

	// Ensure current section is valid for the mode
	const validSection = sections.find((s) => s.key === menuSection) ? menuSection : sections[0].key;

	const handleClose = () => dispatch(setMenuOpen(false));

	return (
		<>
			{/* Backdrop */}
			{menuOpen && (
				<div
					className="menu-backdrop"
					onClick={(e) => {
						e.stopPropagation();
						handleClose();
					}}
				/>
			)}

			{/* Slide-in panel */}
			<div
				className={`menu-panel ${menuOpen ? 'open' : ''}`}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="menu-header">
					<div className="menu-brand">
						<UserAvatar size={28} />
						<span className="brand-text">VidCapt</span>
					</div>
					<button type="button" className="menu-close-btn" onClick={handleClose}>
						✕
					</button>
				</div>

				{/* Mode switcher */}
				<div className="menu-mode-switcher">
					{(['host', 'guest'] as AppMode[]).map((m) => (
						<button
							type="button"
							key={m}
							className={`mode-btn ${mode === m ? 'active' : ''}`}
							onClick={() => dispatch(setMode(m))}
							disabled={modeLocked && mode !== m}
							title={modeLocked && mode !== m ? '配信中・接続中はモードを切り替えられません' : undefined}
						>
							{MODE_LABELS[m]}
						</button>
					))}
				</div>

				{/* Section tabs */}
				<div className="menu-tabs">
					{sections.map((s) => (
						<button
							type="button"
							key={s.key}
							className={`menu-tab ${validSection === s.key ? 'active' : ''}`}
							onClick={() => dispatch(setMenuSection(s.key))}
						>
							{s.label}
						</button>
					))}
				</div>

				{/* Section content */}
				<div className="menu-content">
					{validSection === 'video' && <VideoMenu />}
					{validSection === 'gamepad' && <GamepadMenu />}
					{validSection === 'identity' && <IdentityMenu />}
					{/* HostMenu / GuestMenu は SW リスナーや WebRTC 接続を保持するため常にマウント */}
					{mode === 'host' && (
						<div style={{ display: validSection === 'host' ? undefined : 'none' }}>
							<HostMenu />
						</div>
					)}
					{mode === 'guest' && (
						<div style={{ display: validSection === 'guest' ? undefined : 'none' }}>
							<GuestMenu />
						</div>
					)}
				</div>
			</div>
		</>
	);
}
