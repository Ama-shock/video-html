/**
 * HostWebRTC シングルトン管理。
 * HostMenu (lifecycle) と GamepadMenu (guest assignment notification) で共有する。
 */

import type { HostWebRTC } from './host';

let instance: HostWebRTC | null = null;

export function getHostRtc(): HostWebRTC | null {
	return instance;
}

export function setHostRtc(rtc: HostWebRTC | null): void {
	instance = rtc;
}
