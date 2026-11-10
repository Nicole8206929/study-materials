const assert=require('node:assert/strict');
const {chromium,firefox}=require('playwright');
const {AxeBuilder}=require('@axe-core/playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
(async()=>{
 const server=spawn('python3',['-m','http.server','8768','--bind','127.0.0.1'],{cwd:path.join(__dirname,'..'),stdio:'ignore'});
 try {
  for(let i=0;i<30;i++){try{if((await fetch('http://127.0.0.1:8768/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  for(const [name,type] of Object.entries({chromium,firefox})) {
   const browser=await type.launch();
   try {
    const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/upload-automation.json',r=>r.fulfill({json:{version:1,ready:false}}));
    await page.goto('http://127.0.0.1:8768/upload.html',{waitUntil:'networkidle'});
    assert.equal(await page.locator('#startNewUpload').isDisabled(),true);
    assert(await page.locator('#automationSetup').isVisible());
    assert.equal(await page.locator('#legacyChecker').getAttribute('open'),null);
    await page.route('**/upload-automation.json',r=>r.fulfill({json:{version:1,ready:true}}));
    await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    await page.waitForFunction(()=>!document.querySelector('#startNewUpload').disabled);
    await page.locator('#uploadCategories input[value="high-school-physics"]').uncheck();
    await page.locator('#uploadCategories input[value="high-school-math"]').check();
    await page.locator('#uploadCategories input[value="university-math"]').check();
    await page.locator('#uploadSubcategories input[value="analysis"]').check();
    await page.locator('#uploadSubcategories input[value="algebra"]').check();
    assert((await page.locator('#selectedCategoryCount').innerText()).includes('已选 2 类'));
    await page.locator('#uploadTags').fill('课堂资料，数学');await page.locator('#uploadExpected').fill('2');
    await context.route('https://github.com/**',r=>r.fulfill({body:'<html lang="zh-CN"><title>Private upload fixture</title><p>Private upload fixture</p></html>',contentType:'text/html'}));
    const popupPromise=context.waitForEvent('page');await page.locator('#startNewUpload').click();const popup=await popupPromise;await popup.waitForLoadState();
    const u=new URL(popup.url()),batch=u.searchParams.get('tag'),body=u.searchParams.get('body');
    assert(body.includes('"cat":"high-school-math"'));assert(body.includes('"tags":["课堂资料","数学"]'));assert(body.includes('"expectedCount":2'));
    assert(body.includes('"cats":["high-school-math","university-math"]'));
    assert(body.includes('"subcats":["analysis","algebra"]'));
    assert(body.includes('Publish release'));assert(!u.searchParams.has('token'));await popup.close();
    assert.equal(await page.locator('#pendingUploads li').count(),1);
    const receipt={version:1,batch,cat:'high-school-math',cats:['high-school-math','university-math'],stage:'processing',sourceCount:2,bookIds:[],message:'上传成功，正在按所选分类整理。'};
    await page.route('**/upload-status/**',r=>r.fulfill({json:receipt}));
    await page.locator('#refreshUploadStatus').click();await page.waitForFunction(()=>document.querySelector('#pendingUploads').textContent.includes('正在按所选分类'));
    receipt.stage='failed';receipt.message='整理未完成，原件已保留。';await page.locator('#refreshUploadStatus').click();
    await page.waitForFunction(()=>document.querySelector('#pendingUploads').textContent.includes('整理未完成'));
    assert.equal(await page.locator('#completedUploads li').count(),0);
    receipt.stage='ready';receipt.bookIds=['upload-99'];receipt.message='上传成功，已入库。';
    await page.locator('#refreshUploadStatus').click();await page.waitForFunction(()=>document.querySelector('#pendingUploads').children.length===0);
    assert.equal(await page.locator('#completedUploads li').count(),1);
    assert.deepEqual(await page.locator('#completedUploads a').evaluateAll(items=>items.map(a=>new URL(a.href).searchParams.get('cat'))),['high-school-math','university-math']);
    await page.reload();await page.waitForSelector('#completedUploads li');assert.equal(await page.locator('#pendingUploads li').count(),0);
    for(const scheme of ['light','dark']) {
     await page.emulateMedia({colorScheme:scheme});assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
     for(const width of [320,390,768]) {await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
    }
    await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'light'});
    await page.screenshot({path:`/tmp/library-upload-${name}.png`,fullPage:true});
    await page.goto('http://127.0.0.1:8768/upload-setup.html');assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
    assert.equal(await page.locator('input[type=password],input[type=file],textarea').count(),0);assert.deepEqual(errors,[]);
    console.log(`PASS ${name}: destination survives GitHub handoff; pending/failure/ready, no false success, reload recovery, mobile layout and accessibility. GitHub upload itself is stubbed.`);
   }finally{await browser.close();}
  }
 }finally{server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
