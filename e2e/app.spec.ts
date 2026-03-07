import { test, expect } from '@playwright/test';

test.describe('App', () => {
	test('index.html is served and loads React app', async ({ page }) => {
		const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
		expect(response?.status()).toBe(200);
		expect(response?.headers()['content-type']).toContain('text/html');

		// app.js が正しい MIME type でロードされることを確認
		const appJsResponse = await page.request.get('/app.js');
		expect(appJsResponse.status()).toBe(200);
		expect(appJsResponse.headers()['content-type']).toContain('javascript');
	});

	test('React app renders #root content', async ({ page }) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		// React が #root にマウントされるまで待つ (splash or ProfileSetup or Layout)
		await expect(page.locator('#root')).not.toBeEmpty();
	});

	test('splash screen appears then resolves', async ({ page }) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		const root = page.locator('#root');
		await expect(root).not.toBeEmpty({ timeout: 10_000 });
	});

	test('VAPID public key endpoint returns key', async ({ page }) => {
		const response = await page.request.get('/vapid-public-key');
		// Origin ヘッダなしの直アクセスなので 403 (same-origin check)
		expect(response.status()).toBe(403);
	});

	test('gateway-key-id endpoint responds', async ({ page }) => {
		const response = await page.request.get('/gateway-key-id');
		expect(response.status()).toBe(403);
	});

	test('service worker script is served', async ({ page }) => {
		const response = await page.request.get('/sw.js');
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('javascript');
	});

	test('WASM file is served with correct MIME type', async ({ page }) => {
		const response = await page.request.get('/non_resident_vapid_bg.wasm');
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('wasm');
	});

	test('SPA fallback serves index.html for unknown routes', async ({ page }) => {
		const response = await page.goto('/some/unknown/route', { waitUntil: 'domcontentloaded' });
		expect(response?.status()).toBe(200);
		expect(response?.headers()['content-type']).toContain('text/html');
		await expect(page.locator('#root')).toBeAttached();
	});

	test('no console errors during app load', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));

		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(3000);

		// WASM や JS のロードエラーが無いことを確認
		const criticalErrors = errors.filter(
			(e) => e.includes('module script') || e.includes('MIME') || e.includes('WebAssembly'),
		);
		expect(criticalErrors).toEqual([]);
	});
});
