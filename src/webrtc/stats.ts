/**
 * WebRTC 接続統計情報の取得ユーティリティ。
 */

export type ConnectionStats = {
	rttMs: number; // Round-trip time (ms)
	localCandidateType: string; // 'host' | 'srflx' | 'relay'
	remoteCandidateType: string;
};

/**
 * アクティブな ICE candidate pair から接続統計情報を取得する。
 * 接続が確立されていない場合は null を返す。
 */
export async function getConnectionStats(pc: RTCPeerConnection): Promise<ConnectionStats | null> {
	const stats = await pc.getStats();
	for (const report of stats.values()) {
		if (report.type === 'candidate-pair' && report.state === 'succeeded') {
			const rtt = report.currentRoundTripTime;
			if (typeof rtt !== 'number') continue;

			let localType = '';
			let remoteType = '';
			const localCandidate = stats.get(report.localCandidateId);
			const remoteCandidate = stats.get(report.remoteCandidateId);
			if (localCandidate) localType = localCandidate.candidateType ?? '';
			if (remoteCandidate) remoteType = remoteCandidate.candidateType ?? '';

			return {
				rttMs: Math.round(rtt * 1000),
				localCandidateType: localType,
				remoteCandidateType: remoteType,
			};
		}
	}
	return null;
}
