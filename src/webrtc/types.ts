/**
 * WebRTC シグナリングメッセージ型。
 * ホスト ↔ ゲスト間で WebPush 経由でやり取りする。
 */

export type GuestProfile = {
	userId: string; // Ed25519 公開鍵 base64url
	username: string;
	signature: string; // sign(userId || username) base64url — なりすまし防止
};

/** ゲスト → ホスト: 入室要求 */
export type JoinRequest = {
	type: 'join_request';
	profile: GuestProfile;
	guestBundle: string; // ゲストの WebPush サブスクリプションのクレデンシャルバンドル (base64url)
	offerSdp: string; // WebRTC Offer SDP
};

/** ホスト → ゲスト: 入室承認 + Answer SDP */
export type JoinAccepted = {
	type: 'join_accepted';
	answerSdp: string;
	controllerAssignment: number | null; // switch-bt-ws コントローラー ID
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

/** WebRTC データチャネル経由のコントローラー入力 */
export type ControllerInput = {
	type: 'controller_input';
	buttons: boolean[];
	axes: number[];
};
