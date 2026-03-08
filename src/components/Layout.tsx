import { useCallback, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { generateIdenticonDataUrl } from '../identity/identicon';
import type { AppDispatch, RootState } from '../store';
import { setMenuOpen } from '../store/appSlice';
import GuestMainView from './guest/GuestMainView';
import OverlayMenu from './menu/OverlayMenu';
import VideoBackground from './video/VideoBackground';

const CURSOR_HIDE_MS = 3000;

export default function Layout() {
	const dispatch = useDispatch<AppDispatch>();
	const mode = useSelector((s: RootState) => s.app.mode);
	const menuOpen = useSelector((s: RootState) => s.app.menuOpen);
	const publicKeyB64 = useSelector((s: RootState) => s.identity.publicKeyB64);
	const rootRef = useRef<HTMLDivElement>(null);
	const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// ファビコンをアイデンティコンに設定
	useEffect(() => {
		if (!publicKeyB64) return;
		generateIdenticonDataUrl(publicKeyB64).then((dataUrl) => {
			let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
			if (!link) {
				link = document.createElement('link');
				link.rel = 'icon';
				document.head.appendChild(link);
			}
			link.type = 'image/svg+xml';
			link.href = dataUrl;
		});
	}, [publicKeyB64]);

	const showCursor = useCallback(() => {
		if (rootRef.current) rootRef.current.style.cursor = '';
		if (cursorTimer.current) clearTimeout(cursorTimer.current);
		cursorTimer.current = setTimeout(() => {
			if (!menuOpen && rootRef.current) rootRef.current.style.cursor = 'none';
		}, CURSOR_HIDE_MS);
	}, [menuOpen]);

	useEffect(() => {
		showCursor();
		return () => {
			if (cursorTimer.current) clearTimeout(cursorTimer.current);
		};
	}, [showCursor]);

	const handleClick = () => {
		if (!menuOpen) {
			dispatch(setMenuOpen(true));
			showCursor();
		}
	};

	const handleMouseMove = () => {
		showCursor();
	};

	return (
		<div
			ref={rootRef}
			className="app-root"
			onMouseMove={handleMouseMove}
			onClick={handleClick}
		>
			{/* Video always fills background (standalone/host: local capture, guest: remote stream) */}
			{mode === 'guest' ? <GuestMainView /> : <VideoBackground />}

			{/* Overlay menu slides in from right */}
			<OverlayMenu />
		</div>
	);
}
