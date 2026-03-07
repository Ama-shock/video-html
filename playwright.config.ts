import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	timeout: 30_000,
	retries: 0,
	use: {
		baseURL: process.env.BASE_URL ?? 'http://localhost',
		headless: true,
	},
	projects: [
		{ name: 'chromium', use: { browserName: 'chromium' } },
	],
});
