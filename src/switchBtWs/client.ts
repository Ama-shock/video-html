/**
 * switch-bt-ws WebSocket クライアント。
 *
 * switch-bt-ws が期待する JSON メッセージ形式で入力を送る。
 * コントローラー ID ごとに ws://localhost:8765/ws/<id> に接続する。
 */

export type SwitchBtWsStatus = {
	paired: boolean;
	rumble: boolean;
	rumble_left: number; // 0〜255
	rumble_right: number; // 0〜255
};

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

type StatusCallback = (status: SwitchBtWsStatus) => void;
type ConnectionCallback = (status: ConnectionStatus) => void;
type LinkKeysCallback = (data: string) => void;
type RumbleCallback = (left: number, right: number) => void;

export class SwitchBtWsClient {
	private ws: WebSocket | null = null;
	private wsUrl: string;
	private statusCb: StatusCallback | null = null;
	private connectionCb: ConnectionCallback | null = null;
	private linkKeysCb: LinkKeysCallback | null = null;
	private rumbleCb: RumbleCallback | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private shouldConnect = false;
	public controllerId: number;

	constructor(wsBaseUrl: string, controllerId: number) {
		this.wsUrl = `${wsBaseUrl}/ws/${controllerId}`;
		this.controllerId = controllerId;
	}

	onStatus(cb: StatusCallback): this {
		this.statusCb = cb;
		return this;
	}
	onConnection(cb: ConnectionCallback): this {
		this.connectionCb = cb;
		return this;
	}
	onLinkKeys(cb: LinkKeysCallback): this {
		this.linkKeysCb = cb;
		return this;
	}
	onRumble(cb: RumbleCallback): this {
		this.rumbleCb = cb;
		return this;
	}

	connect(): void {
		this.shouldConnect = true;
		this.open();
	}

	disconnect(): void {
		this.shouldConnect = false;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}

	private open(): void {
		if (this.ws) return;
		this.connectionCb?.('connecting');
		const ws = new WebSocket(this.wsUrl);
		this.ws = ws;

		ws.onopen = () => this.connectionCb?.('connected');

		ws.onmessage = (ev) => {
			try {
				const msg = JSON.parse(ev.data as string) as { type: string; [k: string]: unknown };
				if (msg.type === 'status') {
					const rl = (msg.rumble_left as number) ?? 0;
					const rr = (msg.rumble_right as number) ?? 0;
					this.statusCb?.({
						paired: msg.paired as boolean,
						rumble: msg.rumble as boolean,
						rumble_left: rl,
						rumble_right: rr,
					});
										if (this.rumbleCb) {
						if (rl > 0 || rr > 0 || msg.rumble) this.rumbleCb(rl / 255, rr / 255);
						else this.rumbleCb(0, 0);
					}
				} else if (msg.type === 'rumble') {
					const left = (msg.left as number ?? 0) / 255;
					const right = (msg.right as number ?? 0) / 255;
					if (this.rumbleCb) {
						if (left > 0 || right > 0) this.rumbleCb(left, right);
						else this.rumbleCb(0, 0);
					}
				} else if (msg.type === 'link_keys') {
					this.linkKeysCb?.(msg.data as string);
				}
			} catch {
				/* ignore */
			}
		};

		ws.onclose = () => {
			this.ws = null;
			this.connectionCb?.('disconnected');
			if (this.shouldConnect) {
				this.reconnectTimer = setTimeout(() => this.open(), 3000);
			}
		};

		ws.onerror = () => {
			this.connectionCb?.('error');
		};
	}

	private send(msg: object): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		}
	}

	/** キーマップ適用済みのボタンビットマスク + 軸値を送信する。 */
	sendGamepadInput(buttonStatus: number, axes: number[]): void {
		this.send({ type: 'gamepad_state', button_status: buttonStatus, axes });
	}

	/** 生のボタン配列 + 軸値を送信する（Rust 側でマッピング）。 */
	sendGamepadState(buttons: boolean[], axes: number[]): void {
		this.send({ type: 'gamepad_state', buttons, axes });
	}
}
