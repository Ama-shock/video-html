/**
 * コンパクトな入力状態ビジュアライザ。
 *
 * ボタン押下状態を小さなドットで、スティック位置を十字マーカーで表示する。
 * 接続マップやデバイスリストに埋め込んで使う。
 */

import { useEffect, useRef, useState } from 'react';
import {
	getKeyboardState,
	startKeyboardListening,
	stopKeyboardListening,
} from '../../keyboard/index';

export type InputState = {
	buttons: boolean[];
	axes: number[]; // [-1, 1] or [0, 4095]
};

/**
 * ゲームパッドインデックスからリアルタイム入力状態を取得するフック。
 * `requestAnimationFrame` でポーリングし、変化時のみ再描画する。
 */
export function useGamepadInput(gamepadIndex: number | null): InputState | null {
	const [input, setInput] = useState<InputState | null>(null);
	const lastRef = useRef('');

	useEffect(() => {
		if (gamepadIndex == null || gamepadIndex < 0) return;
		let raf: number;
		const poll = () => {
			const gp = navigator.getGamepads()[gamepadIndex];
			if (gp) {
				const buttons = gp.buttons.map((b) => b.pressed);
				const axes = Array.from(gp.axes);
				const key = `${buttons.join(',')}|${axes.map((a) => a.toFixed(2)).join(',')}`;
				if (key !== lastRef.current) {
					lastRef.current = key;
					setInput({ buttons, axes });
				}
			}
			raf = requestAnimationFrame(poll);
		};
		raf = requestAnimationFrame(poll);
		return () => cancelAnimationFrame(raf);
	}, [gamepadIndex]);

	return input;
}

/**
 * キーボード入力状態をリアルタイムで取得するフック。
 * マウント中はキーボードリスニングを有効にする（ref-count 方式）。
 */
export function useKeyboardInput(): InputState | null {
	const [input, setInput] = useState<InputState | null>(null);
	const lastRef = useRef('');

	useEffect(() => {
		startKeyboardListening();
		let raf: number;
		const poll = () => {
			const state = getKeyboardState();
			const key = state.buttons.join(',');
			if (key !== lastRef.current) {
				lastRef.current = key;
				setInput({ buttons: state.buttons, axes: state.axes });
			}
			raf = requestAnimationFrame(poll);
		};
		raf = requestAnimationFrame(poll);
		return () => {
			cancelAnimationFrame(raf);
			stopKeyboardListening();
		};
	}, []);

	return input;
}

// Button layout: 4 face buttons + 4 shoulder + 4 system + 4 dpad + 2 extra = 18
const BUTTON_POSITIONS: [number, number][] = [
	// face: A B X Y (right cluster)
	[52, 14],
	[58, 8],
	[46, 8],
	[52, 2],
	// shoulder: LB RB LT RT
	[10, 0],
	[56, 0],
	[4, 0],
	[62, 0],
	// system: Back Start L3 R3
	[26, 10],
	[40, 10],
	[20, 18],
	[46, 18],
	// dpad: Up Down Left Right
	[14, 8],
	[14, 14],
	[8, 11],
	[20, 11],
	// extra: Home Screenshot
	[30, 14],
	[36, 14],
];

export default function InputVisualizer({ input }: { input: InputState | null }) {
	if (!input) {
		return <div className="input-viz empty" />;
	}

	// Normalize axes to [-1, 1]
	const ax = (i: number): number => {
		const v = input.axes[i] ?? 0;
		// If pre-mapped (0-4095), normalize
		if (Math.abs(v) > 1.5) return (v / 4095) * 2 - 1;
		return v;
	};

	const lx = ax(0);
	const ly = ax(1);
	const rx = ax(2);
	const ry = ax(3);

	return (
		<svg
			className="input-viz"
			viewBox="0 0 66 22"
			width={99}
			height={33}
			role="img"
			aria-label="Input"
		>
			{/* Buttons */}
			{BUTTON_POSITIONS.map(([x, y], i) => (
				<circle
					key={`${x}-${y}`}
					cx={x}
					cy={y}
					r={1.8}
					fill={input.buttons[i] ? 'var(--accent)' : 'var(--bg3)'}
					stroke={input.buttons[i] ? 'var(--accent)' : 'var(--border)'}
					strokeWidth={0.4}
				/>
			))}
			{/* Left stick */}
			<circle cx={20} cy={8} r={4} fill="none" stroke="var(--border)" strokeWidth={0.4} />
			<circle cx={20 + lx * 3} cy={8 + ly * 3} r={1.2} fill="var(--success)" />
			{/* Right stick */}
			<circle cx={46} cy={14} r={4} fill="none" stroke="var(--border)" strokeWidth={0.4} />
			<circle cx={46 + rx * 3} cy={14 + ry * 3} r={1.2} fill="var(--success)" />
		</svg>
	);
}
