import { defineConfig } from '@playwright/test';
import { resolve4 } from 'node:dns/promises';

// Docker 内で Chromium はコンテナ名を解決できないため、IP に変換する
const rawUrl = process.env.BASE_URL ?? 'http://localhost:3000';
const parsed = new URL(rawUrl);
let baseURL = rawUrl;
try {
	const [ip] = await resolve4(parsed.hostname);
	baseURL = `${parsed.protocol}//${ip}:${parsed.port}`;
} catch {
	// localhost 等の場合はそのまま使用
}

export default defineConfig({
	testDir: './e2e',
	timeout: 30_000,
	retries: 0,
	use: {
		baseURL,
		headless: true,
	},
	projects: [
		{
			name: 'chromium',
			use: {
				browserName: 'chromium',
				launchOptions: {
					args: ['--no-sandbox'],
				},
			},
		},
	],
});
