/**
 * WebRTC シグナリングメッセージ型。
 * ホスト ↔ ゲスト間で WebPush 経由でやり取りする。
 */

export type GuestProfile = {
	userId: string; // Ed25519 公開鍵 base64url
	username: string;
	signature: string; // sign(userId || username) base64url — なりすまし防止
};

/** ゲスト → ホスト: 入室要求 (WebPush: SDP + 最小限の識別情報のみ) */
export type JoinRequest = {
	type: 'join_request';
	/** ゲストの userId（Ed25519 公開鍵 base64url） */
	userId: string;
	guestBundle: string; // ゲストの WebPush サブスクリプションのクレデンシャルバンドル (base64url)
	offerSdp: string; // WebRTC Offer SDP
};

/** ホスト → ゲスト: 入室承認 + Answer SDP (WebPush: SDP のみ) */
export type JoinAccepted = {
	type: 'join_accepted';
	answerSdp: string;
};

/** DataChannel 経由でゲストが接続後に送るプロフィール */
export type GuestIntroduce = {
	type: 'guest_introduce';
	profile: GuestProfile;
};

/** DataChannel 経由でホストが接続後に送る初期情報 */
export type HostWelcome = {
	type: 'host_welcome';
	hostProfile?: { userId: string; username: string };
	videoQuality?: string;
	controllerAssignment: number | null;
	playerNumber?: number | null;
};

/** ホスト → ゲスト: 入室拒否 */
export type JoinRejected = {
	type: 'join_rejected';
	reason?: string;
};

/** ホスト → ゲスト: 切断通知 */
export type HostDisconnect = {
	type: 'host_disconnect';
};

export type SignalingMessage = JoinRequest | JoinAccepted | JoinRejected | HostDisconnect;

/** WebRTC データチャネル経由のコントローラー入力 (ゲスト → ホスト) */
export type ControllerInput = {
	type: 'controller_input';
	buttons: boolean[];
	axes: number[];
};

/** ホスト → ゲスト: コントローラー割り当て変更通知 */
export type ControllerAssignmentCommand = {
	type: 'controller_assignment';
	controllerId: number | null;
	playerNumber: number | null; // P1〜P4 (null = 未割り当て)
};

/** WebRTC データチャネル経由のホストコマンド (ホスト → ゲスト) */
export type HostCommand = QualityChangeCommand | GuestListCommand | HostWelcome | ControllerAssignmentCommand;

export type QualityChangeCommand = {
	type: 'quality_change';
	videoQuality: string; // 'high' | 'medium' | 'low'
};

/** 同室ゲスト一覧通知 */
export type GuestListCommand = {
	type: 'guest_list';
	guests: PeerInfo[];
};

export type PeerInfo = {
	userId: string;
	username: string;
};
