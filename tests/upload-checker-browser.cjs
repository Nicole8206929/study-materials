const assert = require('node:assert/strict');
const {chromium, firefox} = require('playwright');
const {AxeBuilder} = require('@axe-core/playwright');
const {createHash, createCipheriv, randomBytes} = require('node:crypto');
const {spawn, execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1'], {cwd: root, stdio: 'ignore'});
  let browser;
  try {
    for (let n = 0; n < 30; n++) { try { if ((await fetch('http://127.0.0.1:8766/')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const all = Array.from({length: 97}, (_, i) => ({name: `${i + 1}.pptx`, mimeType: 'application/octet-stream', buffer: Buffer.from(`presentation ${i + 1}`)}));
    const state = {version: 1, checkedAt: '2026-11-09T10:00:00Z', expectedCount: 97,
      uploaded: all.slice(0, 81).map(file => ({size: file.buffer.length, sha256: createHash('sha256').update(file.buffer).digest('hex')}))};
    const key = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final(), cipher.getAuthTag()]);
    const envelope = {version: 1, iv: iv.toString('base64url'), data: data.toString('base64url')};
    for (const engine of [chromium, firefox]) {
      browser = await engine.launch({headless: true});
      const context = await browser.newContext({viewport: {width: 390, height: 844}, acceptDownloads: true});
      await context.route('**/upload-check-data/*.json', route => route.fulfill({json: envelope}));
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const url = `http://127.0.0.1:8766/upload.html?batch=${'a'.repeat(32)}#k=${key.toString('base64url')}`;
      await page.goto(url, {waitUntil: 'networkidle'});
      assert.equal(await page.locator('#checkFiles').count(), 1);
      await page.waitForFunction(() => !document.querySelector('#checkFiles').disabled);
      const requests = []; page.on('request', request => requests.push(request.url()));
      await page.locator('#checkFiles').setInputFiles(all);
      await page.waitForFunction(() => document.querySelector('#checkSummary').textContent.includes('待补传 16'));
      assert((await page.locator('#checkSummary').innerText()).includes('已上传 81'));
      await page.locator('#makePackage').click();
      await page.waitForSelector('#downloadPackage:not([hidden])');
      const downloaded = page.waitForEvent('download');
      await page.locator('#downloadPackage').click();
      const download = await downloaded;
      const saved = path.join('/tmp', `checker-${engine.name()}.zip`);
      await download.saveAs(saved);
      const listing = JSON.parse(execFileSync('python3', ['-c', 'import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))', saved], {encoding:'utf8'}));
      assert.equal(Object.keys(listing).length, 16);
      assert(Object.values(listing).every((value, index) => value === `presentation ${index + 82}`));
      assert(requests.every(request => request.startsWith('blob:')), 'local files must not cause network requests');
      assert.equal(await page.locator('#privateUpload').getAttribute('href'), 'https://github.com/Nicole8206929/study-materials-originals/releases');
      assert((await page.locator('#nextSteps').innerText()).includes('Save draft'));
      if (engine === chromium) {
        for (const scheme of ['light', 'dark']) {
          await page.emulateMedia({colorScheme: scheme});
          assert.deepEqual((await new AxeBuilder({page}).analyze()).violations, []);
          for (const width of [320,390,768,1440]) {
            await page.setViewportSize({width, height: 900});
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          }
        }
        await page.setViewportSize({width:390,height:844}); await page.emulateMedia({colorScheme:'light'});
        await page.screenshot({path:'/tmp/local-checker-mobile.png',fullPage:true});
      }
      await page.locator('#checkFiles').setInputFiles(all.slice(0, 81));
      await page.waitForFunction(() => document.querySelector('#checkSummary').textContent.includes('待补传 0'));
      assert.equal(await page.locator('#makePackage').isVisible(), false);
      assert.equal(await page.locator('#downloadPackage').isVisible(), false);
      await page.goto(url.replace(/#k=.*/, '#k=' + randomBytes(32).toString('base64url')));
      await page.waitForFunction(() => document.querySelector('#inventoryStatus').textContent.includes('不完整'));
      assert.equal(await page.locator('#checkFiles').isDisabled(), true);
      assert.deepEqual(errors, []);
      await context.close(); await browser.close(); browser = null;
      console.log(`PASS ${engine.name()}: private link, select 97 / skip 81 / package 16, valid ZIP download, no file network transfer, all-uploaded and bad-key handling.`);
    }
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
