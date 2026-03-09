/**
 * ユーザー操作コンテキストで AudioContext を resume し、
 * ブラウザの音声出力許可を取得する。
 *
 * ボタンクリックなどのイベントハンドラ内で呼ぶこと。
 * 一度 resume すれば以降の play() は音声付きで再生できる。
 */

let audioCtx: AudioContext | null = null;

export function unlockAudio(): void {
	try {
		if (!audioCtx) {
			audioCtx = new AudioContext();
		}
		if (audioCtx.state === 'suspended') {
			audioCtx.resume();
		}
	} catch {
		/* ignore — AudioContext 未対応環境 */
	}
}
