/**
 * 公開鍵バイト列からアイデンティコン SVG を生成する。
 *
 * 5×5 グリッド、左右対称。
 * 公開鍵の SHA-256 ハッシュからグリッドパターンと色を決定する。
 */

export async function generateIdenticon(publicKeyB64: string): Promise<string> {
	const bytes = fromBase64Url(publicKeyB64);
	const hash = new Uint8Array(
		await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>),
	);
	return buildSvg(hash);
}

/**
 * SVG を data: URL として返す（<img src=> に使える）
 */
export async function generateIdenticonDataUrl(publicKeyB64: string): Promise<string> {
	const svg = await generateIdenticon(publicKeyB64);
	return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function buildSvg(hash: Uint8Array): string {
	const GRID = 5;
	const CELL = 10;
	const SIZE = GRID * CELL;
	const PAD = 5;
	const TOTAL = SIZE + PAD * 2;

	// 色: hash[0..2] → HSL
	const hue = Math.round((hash[0] / 255) * 360);
	const sat = 40 + Math.round((hash[1] / 255) * 40);
	const lig = 30 + Math.round((hash[2] / 255) * 20);
	const color = `hsl(${hue},${sat}%,${lig}%)`;
	const bg = `hsl(${hue},${Math.round(sat * 0.3)}%,92%)`;

	// グリッド: 5×5 左右対称 (3 列分のビットで決定)
	const cells: string[] = [];
	let byteIdx = 3;
	for (let row = 0; row < GRID; row++) {
		for (let col = 0; col < 3; col++) {
			const bit = (hash[byteIdx] >> col) & 1;
			byteIdx = (byteIdx + 1) % hash.length;
			if (bit) {
				// left column
				cells.push(rect(col, row, CELL, PAD, color));
				// mirror right column (skip center)
				if (col < 2) {
					cells.push(rect(GRID - 1 - col, row, CELL, PAD, color));
				}
			}
		}
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TOTAL} ${TOTAL}" width="${TOTAL}" height="${TOTAL}">
  <rect width="${TOTAL}" height="${TOTAL}" fill="${bg}" rx="4"/>
  ${cells.join('\n  ')}
</svg>`;
}

function rect(col: number, row: number, cell: number, pad: number, fill: string): string {
	const x = pad + col * cell;
	const y = pad + row * cell;
	return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${fill}"/>`;
}

function fromBase64Url(b64: string): Uint8Array {
	const pad = b64.replace(/-/g, '+').replace(/_/g, '/');
	const padding = '='.repeat((4 - (pad.length % 4)) % 4);
	const bin = atob(pad + padding);
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
