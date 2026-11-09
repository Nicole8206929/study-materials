const assert = require('node:assert/strict');
const {chromium,firefox} = require('playwright');
const {createHash,createCipheriv,randomBytes} = require('node:crypto');
const {spawn} = require('node:child_process');
const path = require('node:path');
(async () => {
  const server = spawn('python3',['-m','http.server','8767','--bind','127.0.0.1'],{cwd:path.join(__dirname,'..'),stdio:'ignore'});
  let browser;
  try {
    for (let n=0;n<30;n++) { try { if ((await fetch('http://127.0.0.1:8767')).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
    const files = Array.from({length:97},(_,i)=>({name:`${i+1}.pptx`,mimeType:'application/octet-stream',buffer:Buffer.from(`original ${i+1}`)}));
    const uploaded = files.map(file=>({size:file.buffer.length,sha256:createHash('sha256').update(file.buffer).digest('hex')}));
    const key = randomBytes(32);
    function encrypt(count,archived) {
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
      const data=Buffer.concat([cipher.update(JSON.stringify({version:1,checkedAt:new Date().toISOString(),expectedCount:97,...(archived?{stage:'compiled'}:{}),uploaded:uploaded.slice(0,count)})),cipher.final(),cipher.getAuthTag()]);
      return {version:1,iv:iv.toString('base64url'),data:data.toString('base64url')};
    }
    for (const engine of [chromium,firefox]) {
      browser=await engine.launch(); const context=await browser.newContext();
      await context.addInitScript(()=>{
        window.testVisible=true; window.testWakeLocks=[];
        Object.defineProperty(document,'visibilityState',{get:()=>window.testVisible?'visible':'hidden'});
        Object.defineProperty(navigator,'wakeLock',{value:{request:async()=>{
          const lock=new EventTarget(); lock.released=false;
          lock.release=async()=>{lock.released=true;lock.dispatchEvent(new Event('release'));};
          window.testWakeLocks.push(lock);return lock;
        }}});
        window.returnToChecker=()=>{window.testVisible=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));};
      });
      let count=81,offline=false,archived=false;
      await context.route('**/upload-check-data/*.json',route=>offline?route.abort():route.fulfill({json:encrypt(count,archived)}));
      const page=await context.newPage(),errors=[],requests=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
      await page.goto(`http://127.0.0.1:8767/upload.html?batch=${'a'.repeat(32)}#k=${key.toString('base64url')}`);
      await page.waitForFunction(()=>document.querySelector('#inventoryStatus').textContent.includes('已载入 81'));
      await page.locator('#checkFiles').setInputFiles(files);
      await page.waitForFunction(()=>document.querySelector('#checkSummary').textContent.includes('待补传 16'));
      await page.locator('#makePackage').click(); await page.waitForSelector('#downloadPackage:not([hidden])');
      const href=await page.locator('#downloadPackage').getAttribute('href');
      await page.evaluate(()=>window.returnToChecker());
      await page.waitForFunction(()=>document.querySelector('#resumeStatus').textContent.includes('记录未变'));
      assert.equal(await page.locator('#downloadPackage').getAttribute('href'),href,'same record keeps an existing package');
      count=97;
      await page.evaluate(()=>window.returnToChecker());
      await page.waitForFunction(()=>document.querySelector('#checkSummary').textContent.includes('已上传 97'));
      assert.equal(await page.locator('#selectedFiles button').count(),97);
      assert.equal(await page.locator('#downloadPackage').isVisible(),false,'fresh uploads invalidate the old missing package');
      offline=true; await page.evaluate(()=>window.returnToChecker());
      await page.waitForFunction(()=>document.querySelector('#resumeStatus').textContent.includes('暂未刷新'));
      assert((await page.locator('#checkSummary').innerText()).includes('已上传 97'));
      offline=false; await page.evaluate(()=>window.returnToChecker());
      await page.waitForFunction(()=>document.querySelector('#resumeStatus').textContent.includes('记录未变'));
      archived=true; await page.evaluate(()=>window.returnToChecker());
      await page.waitForFunction(()=>document.querySelector('#checkSummary').textContent.includes('已归档 97'));
      assert((await page.locator('#inventoryStatus').innerText()).includes('只保留最终合集'));
      await page.locator('#clearSelection').click();
      await page.evaluate(()=>{
        const read=Blob.prototype.arrayBuffer;window.failPhoneRead=true;
        Blob.prototype.arrayBuffer=function(){if(window.failPhoneRead){window.failPhoneRead=false;return Promise.reject(new Error('provider suspended'));}return read.call(this);};
      });
      await page.locator('#checkFiles').setInputFiles({name:'recover.pptx',mimeType:'application/octet-stream',buffer:Buffer.from('recover this original file')});
      await page.waitForFunction(()=>document.querySelector('#checkSummary').textContent.includes('未能核对 1'));
      await page.evaluate(()=>window.returnToChecker());
      await page.waitForFunction(()=>document.querySelector('#checkSummary').textContent.includes('未能核对 0'),null,{timeout:5000});
      assert((await page.locator('#checkSummary').innerText()).includes('待补传 1'),'transient file-provider failure retries the retained file on return');
      await page.locator('#clearSelection').click();
      await page.evaluate(()=>{
        const read=Blob.prototype.arrayBuffer;
        Blob.prototype.arrayBuffer=async function(){await new Promise(r=>setTimeout(r,40));return read.call(this);};
      });
      await page.locator('#checkFiles').setInputFiles({name:'large.pptx',mimeType:'application/octet-stream',buffer:Buffer.alloc(4*1024*1024)});
      await page.waitForFunction(()=>window.testWakeLocks.some(lock=>!lock.released));
      await page.evaluate(()=>{window.testVisible=false;document.dispatchEvent(new Event('visibilitychange'));});
      await page.waitForFunction(()=>window.testWakeLocks.every(lock=>lock.released));
      assert((await page.locator('#backgroundStatus').innerText()).includes('后台'));
      await page.evaluate(()=>window.returnToChecker());
      await page.waitForFunction(()=>document.querySelector('#checkSummary').textContent.includes('待补传 1'));
      assert.equal(await page.locator('#selectedFiles button').count(),1);
      await page.waitForFunction(()=>window.testWakeLocks.every(lock=>lock.released));
      await page.locator('#clearSelection').click();
      await page.locator('#checkFiles').setInputFiles({name:'cancel.pptx',mimeType:'application/octet-stream',buffer:Buffer.alloc(4*1024*1024)});
      await page.waitForSelector('#cancelCheck:not([hidden])'); await page.locator('#cancelCheck').click();
      await page.waitForFunction(()=>document.querySelector('#checkStatus').textContent.includes('已取消'));
      await page.evaluate(()=>window.returnToChecker());
      await page.waitForFunction(()=>document.querySelector('#resumeStatus').textContent.includes('记录未变'));
      assert((await page.locator('#checkStatus').innerText()).includes('已取消'),'return does not undo a deliberate cancellation');
      archived=false; await page.evaluate(()=>window.returnToChecker());
      await page.waitForFunction(()=>document.querySelector('#checkStatus').textContent.includes('保持停止'));
      assert.equal(await page.locator('#cancelCheck').isVisible(),false,'updated records also respect a deliberate cancellation');
      assert(requests.every(item=>item.method==='GET'),'local file bytes never leave through the checker');
      assert.deepEqual(errors,[]);
      console.log(`PASS ${engine.name()}: lifecycle recovery, refreshed 81→97 record, package invalidation, offline retry, screen lock release/reacquire, cancellation preserved (simulated lifecycle).`);
      await context.close();await browser.close();browser=null;
    }
  } finally {if(browser)await browser.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
