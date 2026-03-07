/**
 * switch-bt-ws WebSocket クライアント。
 *
 * switch-bt-ws が期待する JSON メッセージ形式で入力を送る。
 * コントローラー ID ごとに ws://localhost:8765/ws/<id> に接続する。
 */

export type SwitchBtWsStatus = {
	paired: boolean;
	rumble: boolean;
};

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

type StatusCallback = (status: SwitchBtWsStatus) => void;
type ConnectionCallback = (status: ConnectionStatus) => void;

export class SwitchBtWsClient {
	private ws: WebSocket | null = null;
	private wsUrl: string;
	private statusCb: StatusCallback | null = null;
	private connectionCb: ConnectionCallback | null = null;
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
				const msg = JSON.parse(ev.data as string) as { type: string } & SwitchBtWsStatus;
				if (msg.type === 'status') {
					this.statusCb?.({ paired: msg.paired, rumble: msg.rumble });
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

	sendButtons(buttonStatus: number): void {
		this.send({ type: 'gamepad_state', buttons: buttonStatus });
	}

	sendGamepadState(buttons: boolean[], axes: number[]): void {
		this.send({ type: 'gamepad_state', buttons, axes });
	}
}
