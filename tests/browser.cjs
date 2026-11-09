const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {AxeBuilder} = require('@axe-core/playwright');
const {spawn} = require('node:child_process');
const path = require('node:path');
const catalog = require('../books.json');
const total = catalog.books.length;
(async () => {
  const server = spawn('python3', ['-m','http.server','8765','--bind','127.0.0.1'], {cwd:path.join(__dirname,'..'),stdio:['ignore','pipe','pipe']});
  let browser;
  try {
    for(let n=0;n<30;n++) { try { if((await fetch('http://127.0.0.1:8765/')).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
    browser = await chromium.launch({headless:true});
    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    const page = await context.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8765/');
    await page.waitForSelector('.book');
    assert.equal(await page.locator('input[type=password]').count(),0);
    assert.equal(await page.locator('.book').count(),total);
    assert.equal(await page.locator('.category').count(),catalog.categories.length + 1);
    for (const [id, name] of [
      ['high-school-physics','高中物理'], ['university-physics','大学物理'],
      ['high-school-math','高中数学'], ['competition-math','竞赛数学'], ['university-math','大学数学']
    ]) {
      const category = page.locator(`.category[data-value="${id}"]`);
      assert((await category.innerText()).includes(name));
      const count = catalog.books.filter(book=>book.cat===id).length;
      assert.equal(await category.locator('.category-count').innerText(),String(count));
      await category.click();
      assert.equal(await page.locator('.book').count(),count);
      if (!count) assert.equal(await page.locator('#emptyStateTitle').innerText(),`${name}暂未添加书籍`);
      await page.reload();
      await page.waitForFunction(()=>document.querySelector('#books').getAttribute('aria-busy')==='false');
      assert.equal(await page.locator(`.category[data-value="${id}"]`).getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('.book').count(),count);
      if (!count) assert(await page.locator('#emptyState').isVisible());
    }
    await page.locator('#resetFilters').click();
    assert.equal(await page.locator('.book').count(),total);
    assert.equal(await page.locator('a[download],.download,iframe').count(),0);
    assert.equal(await page.locator('.book-access').count(),total);
    assert.equal(await page.locator('[data-id="robbins-ob"] .book-top span').first().innerText(),'管理');
    await page.locator('#search').fill('宏观经济学原理');
    assert(await page.locator('[data-id="macro3e"]').isVisible());
    await page.locator('#search').fill('  曼昆   微观 ');
    assert(await page.locator('[data-id="mankiw-micro"]').isVisible());
    await page.reload(); await page.waitForSelector('.book');
    assert(await page.locator('[data-id="mankiw-micro"]').isVisible());
    await page.locator('#resetFilters').click();
    await page.locator('#format').selectOption('epub');
    assert.equal(await page.locator('.book').count(),catalog.books.filter(book=>book.format==='EPUB').length);
    await page.locator('[data-id="rosenberg-nvc"] .view').click();
    await page.waitForSelector('#previewPages img');
    await page.waitForFunction(()=>document.querySelector('#previewPages img').naturalWidth>0);
    assert.equal(await page.locator('#previewPages img').count(),10);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.querySelector('#previewPages').children.length===0);
    assert.equal(await page.evaluate(()=>document.activeElement.className),'view');
    await page.locator('#resetFilters').click();
    await page.locator('#search').fill('no-such-book');
    assert(await page.locator('#emptyState').isVisible());
    await page.locator('#emptyReset').click();
    // Full originals must not be served, even when their historical paths are known.
    for(const original of ['心理金融书籍/FinancialAccounting_Jonick.pdf','心理金融书籍/Rosenberg_Nonviolent_Communication.epub']) {
      assert.equal((await fetch('http://127.0.0.1:8765/'+encodeURI(original))).status,404);
    }
    for(const scheme of ['light','dark']) {
      await page.emulateMedia({colorScheme:scheme});
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
      for(const width of [320,390,768,1440]) {
        await page.setViewportSize({width,height:900});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
    }
    await page.setViewportSize({width:390,height:844});
    await page.emulateMedia({colorScheme:'light'});
    await page.reload(); await page.waitForSelector('.book');
    assert.equal(await page.locator('#tagDetails').getAttribute('open'),null);
    await page.screenshot({path:'/tmp/locked-shelf-mobile.png',fullPage:true});
    await page.route('**/books.json',route=>route.fulfill({status:500,body:'error'}));
    await page.reload(); await page.waitForSelector('#loadError:not([hidden])');
    await page.route('**/books.json',route=>route.fulfill({json:catalog}));
    await page.locator('#retryLoad').click(); await page.waitForSelector('.book');
    assert.equal(await page.locator('.book').count(),total);
    const hostile={...catalog,books:[{...catalog.books[0],title:'<img src=x onerror=alert(1)>'}]};
    await page.route('**/books.json',route=>route.fulfill({json:hostile}));
    await page.reload(); await page.waitForSelector('.book');
    assert.equal(await page.locator('.book img').count(),0);
    await page.unroute('**/books.json');
    await page.goto('http://127.0.0.1:8765/');
    await page.locator('.owner-entry').click();
    assert(page.url().endsWith('/upload.html'));
    const upload = page.locator('#privateUpload');
    assert.equal(await upload.getAttribute('href'),'https://github.com/Nicole8206929/study-materials-originals/releases');
    assert.equal(await page.locator('#installUploadHelper').getAttribute('href'),'tools/github-upload-helper.user.js');
    assert((await page.locator('#tampermonkeyInstall').getAttribute('href')).startsWith('https://addons.mozilla.org/'));
    assert.equal(await page.locator('input[type=password],input[type=file]').count(),0);
    assert.equal(await page.locator('script[src="assets/upload-install.js"]').count(),1);
    await page.waitForFunction(()=>!document.querySelector('#copyBookmark').disabled);
    assert((await page.locator('.guide-intro').innerText()).includes('手机自带浏览器'));
    assert.equal(await page.locator('#legacyUploadHelper').getAttribute('open'),null);
    assert.equal(await page.locator('#helperScriptUrl').inputValue(),'https://nicole8206929.github.io/study-materials/tools/github-upload-helper.user.js');
    assert((await page.locator('#helperOfficialInstall').getAttribute('href')).startsWith('https://www.tampermonkey.net/script_installation.php#url='));
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    await page.locator('#copyBookmark').click();
    const bookmark=await page.evaluate(()=>navigator.clipboard.readText());
    assert(bookmark.startsWith('javascript:'));
    assert(bookmark.length>1000&&bookmark.length<100000);
    assert.equal(bookmark,await page.locator('#bookmarkAddress').inputValue());
    assert.equal(await page.locator('#bookmarkAddress').isVisible(),false);
    await page.locator('#installPageUrl').locator('..').locator('summary').click();
    await page.locator('#copyInstallPage').click();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),await page.locator('#installPageUrl').inputValue());
    await page.locator('#legacyUploadHelper > summary').click();
    await page.locator('#installTroubleshoot > summary').click();
    await page.locator('#copyHelperScript').click();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),await page.locator('#helperScriptUrl').inputValue());
    await page.locator('#nativeTroubleshoot > summary').click();
    await page.locator('#copyBrowserInfo').click();
    const diagnostic=JSON.parse(await page.evaluate(()=>navigator.clipboard.readText()));
    assert.equal(diagnostic.version,'native-1');assert.equal(diagnostic.bookmarkLoaded,true);assert.equal(diagnostic.bookmarkLength,bookmark.length);
    assert(!Object.keys(diagnostic).some(key=>/^(?:cookies?|token|password|files)$/i.test(key)));
    assert((await page.locator('main').innerText()).includes('Save draft'));
    for (const scheme of ['light','dark']) {
      await page.emulateMedia({colorScheme:scheme});
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
      for (const width of [320,390,768,1440]) {
        await page.setViewportSize({width,height:900});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
    }
    await page.setViewportSize({width:390,height:844});
    await page.emulateMedia({colorScheme:'light'});
    await page.screenshot({path:'/tmp/book-upload-guide-mobile.png',fullPage:true});
    await page.route('**/tools/github-upload-bookmark.txt',route=>route.fulfill({status:503,body:'unavailable'}));
    await page.reload();await page.waitForFunction(()=>document.querySelector('#bookmarkLoadStatus').textContent.includes('未加载'));
    assert.equal(await page.locator('#copyBookmark').isDisabled(),true);
    await page.unroute('**/tools/github-upload-bookmark.txt');
    await page.reload();await page.waitForFunction(()=>!document.querySelector('#copyBookmark').disabled);
    await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('clipboard denied');};});
    await page.locator('#copyBookmark').click();
    assert.equal(await page.locator('#bookmarkAddress').isVisible(),true);
    assert((await page.locator('#installCopyStatus').innerText()).includes('长按'));
    assert.deepEqual(errors,[]);
    console.log('PASS: catalogue, search, limited previews, owner upload navigation, mobile layout, accessibility and error recovery.');
  } finally { if(browser) await browser.close(); server.kill(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
