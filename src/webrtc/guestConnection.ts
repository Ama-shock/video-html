/**
 * GuestWebRTC シングルトン管理。
 * GuestMenu (join/leave) と GuestMainView (video/push/gamepad) の間で共有する。
 */

import type { GuestWebRTC } from './guest';

let instance: GuestWebRTC | null = null;

export function getGuestRtc(): GuestWebRTC | null {
	return instance;
}

export function setGuestRtc(rtc: GuestWebRTC | null): void {
	if (instance && instance !== rtc) {
		instance.close();
	}
	instance = rtc;
}
