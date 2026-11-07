const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const books = require('../books.json').books;
(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  const browser = await chromium.launch({ headless: true });
  try {
    let response;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { response = await fetch('http://127.0.0.1:8765/'); if (response.ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(response?.ok, 'local server starts');
    const errors = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8765/');
    assert(await page.locator('#gate').isVisible());
    await page.locator('#gatePwd').fill('incorrect');
    await page.locator('#gateSubmit').click();
    await page.waitForFunction(() => document.querySelector('#gateErr').textContent.includes('1/5'));
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, [], 'gate accessibility');
    await page.evaluate(() => sessionStorage.setItem('authed', '1'));
    await page.reload();
    await page.waitForSelector('.book');
    assert.equal(await page.locator('.book').count(), books.length);
    assert.equal(await page.locator('.category').count(), 5, 'hide categories without materials');
    await page.locator('#search').fill('  曼昆   微观 ');
    assert.equal(await page.locator('.book').count(), 1, 'multi-word trimmed search');
    await page.reload();
    await page.waitForSelector('.book');
    assert.equal(await page.locator('.book').count(), 1, 'URL preserves search on reload');
    await page.locator('#resetFilters').click();
    await page.locator('#format').selectOption('epub');
    assert.equal(await page.locator('.book').count(), 1);
    assert.equal(await page.locator('.book .view').count(), 0, 'EPUB has no PDF preview');
    assert(await page.locator('.book .download').getAttribute('download'));
    await page.locator('#format').selectOption('all');
    await page.locator('#search').fill('no-such-book-xyz');
    assert(await page.locator('#emptyState').isVisible());
    await page.locator('#emptyReset').click();
    // Stub file contents only; test dialog keyboard/focus behavior without huge downloads.
    await page.route('**/*.pdf', route => route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' }));
    const firstPreview = page.locator('.view').first();
    await firstPreview.click();
    assert(await page.locator('#previewModal').isVisible());
    assert(await page.locator('#previewOpen').getAttribute('href'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#previewFrame').hasAttribute('src'));
    assert(!(await page.locator('#previewModal').isVisible()));
    assert.equal(await page.evaluate(() => document.activeElement.className), 'view');
    assert.equal(await page.locator('#previewFrame').getAttribute('src'), null);
    await page.locator('#search').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'clearSearch');
    await page.locator('#sort').selectOption('size');
    assert.equal(await page.locator('.book').first().getAttribute('data-id'), 'rosenberg-nvc');
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, [], `${colorScheme} accessibility`);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal overflow at ${width}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.screenshot({ path: '/tmp/study-mobile.png', fullPage: true });
    // Catalogue strings are text, not executable HTML; hostile filenames stay local.
    await page.route('**/books.json', route => route.fulfill({ json: { books: [{ ...books[0], title: '<img src=x onerror=alert(1)>', file: "心理金融书籍/a'# ?.pdf" }] } }));
    await page.goto('http://127.0.0.1:8765/');
    await page.waitForSelector('.book');
    assert.equal(await page.locator('.book img').count(), 0);
    assert((await page.locator('.download').getAttribute('href')).includes('%23'));
    await page.route('**/books.json', route => route.fulfill({ status: 500, body: 'error' }));
    await page.reload();
    await page.waitForSelector('#loadError:not([hidden])');
    await page.route('**/books.json', route => route.fulfill({ json: { books } }));
    await page.locator('#retryLoad').click();
    await page.waitForSelector('.book');
    assert.equal(await page.locator('.book').count(), books.length);
    assert.deepEqual(errors, []);
    console.log('PASS: gate, catalogue, search, URL state, EPUB, downloads, dialog, keyboard, light/dark accessibility, 4 viewports, injection and retry.');
  } finally {
    await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
