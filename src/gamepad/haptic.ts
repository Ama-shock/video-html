/**
 * Gamepad Haptic API ラッパー。
 *
 * Chrome: GamepadHapticActuator.playEffect('dual-rumble', ...)
 * Firefox: GamepadHapticActuator.pulse(intensity, duration)
 *
 * ゲスト側で Switch からの振動コマンドを物理コントローラーに伝達する。
 */

/** 選択されているゲームパッドインデックス */
let activeGamepadIndex: number | null = null;

/** 現在の振動状態（重複呼び出し防止） */
let currentLeft = 0;
let currentRight = 0;

export function setActiveGamepad(index: number | null): void {
	activeGamepadIndex = index;
}

/**
 * ゲームパッドを振動させる。
 * @param left 左モーター強度 (0.0〜1.0)
 * @param right 右モーター強度 (0.0〜1.0)
 */
export function playRumble(left: number, right: number): void {
	// 同じ強度なら無視（連続呼び出し防止）
	if (left === currentLeft && right === currentRight) return;
	currentLeft = left;
	currentRight = right;

	if (activeGamepadIndex == null) return;
	const gp = navigator.getGamepads()[activeGamepadIndex];
	if (!gp) return;


	// Chrome / Firefox 130+: vibrationActuator.playEffect
	// duration を短く (50ms) して、継続的な rumble はイベントの連続で維持。
	// 短いパルスは 50ms で自然に止まり、長い振動は連続イベントで持続する。
	const actuator = (gp as any).vibrationActuator;
	if (actuator?.playEffect) {
		actuator.playEffect('dual-rumble', {
			startDelay: 0,
			duration: 50,
			weakMagnitude: left,
			strongMagnitude: right,
		}).catch(() => { /* unsupported */ });
		return;
	}

	// Firefox: hapticActuators[].pulse
	const haptics = (gp as any).hapticActuators;
	if (haptics?.length > 0) {
		const intensity = Math.max(left, right);
		haptics[0].pulse(intensity, 50).catch(() => { /* unsupported */ });
	}
}

/** 振動を停止する */
export function stopRumble(): void {
	if (currentLeft === 0 && currentRight === 0) return;
	currentLeft = 0;
	currentRight = 0;

	if (activeGamepadIndex == null) return;
	const gp = navigator.getGamepads()[activeGamepadIndex];
	if (!gp) return;

	const actuator = (gp as any).vibrationActuator;
	if (actuator?.reset) {
		actuator.reset().catch(() => {});
	} else if (actuator?.playEffect) {
		actuator.playEffect('dual-rumble', {
			startDelay: 0,
			duration: 0,
			weakMagnitude: 0,
			strongMagnitude: 0,
		}).catch(() => {});
	}
}
