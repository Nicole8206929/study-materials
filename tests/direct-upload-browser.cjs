const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {chromium,firefox}=require('playwright');
const {AxeBuilder}=require('@axe-core/playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const service='https://nicole-private-book-upload.vibrantcloth2.chatgpt.site';
(async()=>{
 const server=spawn('python3',['-m','http.server','8791','--bind','127.0.0.1'],{cwd:path.join(__dirname,'..'),stdio:'ignore'});
 try{
  for(let i=0;i<30;i++){try{if((await fetch('http://127.0.0.1:8791/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  for(const [name,type] of Object.entries({chromium,firefox})){
   const browser=await type.launch();
   try{
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await context.addInitScript(()=>localStorage.setItem('nicole-direct-session-v1',JSON.stringify({token:'v'.repeat(43),scope:'owner',expires:Date.now()/1000+86400})));
    let serviceReady=false;
    await page.route('**/upload-service.json',r=>r.fulfill({json:{version:1,ready:serviceReady,endpoint:service}}));
    const cors={'Access-Control-Allow-Origin':'http://127.0.0.1:8791','Access-Control-Allow-Headers':'authorization,content-type,x-chunk-sha256,x-upload-request','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Content-Type':'application/json'};
    let batch,spec,stored,allowVerified=false,ready=false,puts=0,failedMode=false,loseFinalResponse=true,finalizes=0,pairCalls=0;
    await context.route(service+'/**',async route=>{
     const req=route.request(),url=new URL(req.url()),method=req.method();
     const send=(data,status=200)=>route.fulfill({status,headers:cors,body:JSON.stringify(data)});
     if(method==='OPTIONS')return route.fulfill({status:204,headers:cors});
     if(url.pathname==='/health')return send({version:1,archiveReady:true,chunkSize:8*1024*1024});
     if(url.pathname==='/api/session')return req.headers().authorization==='Bearer '+'v'.repeat(43)?send({connected:true,scope:'owner'}):send({error:{code:'session_required',message:'权限不可用'}},401);
     if(url.pathname==='/api/pair'){pairCalls++;return send({error:{code:'pairing_used',message:'已使用'}},409);}
     if(url.pathname==='/api/batches'&&method==='GET')return send({batches:[]});
     if(url.pathname==='/api/batches'&&method==='POST'){
      const body=req.postDataJSON();batch=body.batch;spec=body.spec;stored=null;return send({batch,state:'uploading',chunkSize:8*1024*1024},201);
     }
     if(url.pathname.endsWith('/files')&&method==='POST'){
      stored={id:'file-1234abcd',...req.postDataJSON(),state:'uploading',parts:[],receivedBytes:0};
      return send({file:stored,chunkSize:8*1024*1024},201);
     }
     const part=/\/parts\/(\d+)$/.exec(url.pathname);
     if(part&&method==='PUT'){
      puts++;
      if(failedMode)return send({error:{code:'forbidden',message:'上传授权不可用。',requestId:'browser-fixture-403'}},403);
      const number=Number(part[1]),bytes=req.postDataBuffer(),hash=createHash('sha256').update(bytes).digest('hex');
      assert.equal(req.headers()['x-chunk-sha256'],hash);
      const result={number,sha256:hash,size:bytes.length};stored.parts.push(result);stored.receivedBytes+=bytes.length;
      if(number===1)return send({error:{code:'temporary',message:'响应临时中断',requestId:'fixture-503'}},503);
      return send(result);
     }
     if(url.pathname.endsWith('/complete')){stored.state='verifying';return send({file:stored},202);}
     if(/\/files\/file-/.test(url.pathname)){
      if(stored.state==='verifying'&&allowVerified)stored.state='complete';return send({file:stored,chunkSize:8*1024*1024});
     }
     if(url.pathname.endsWith('/finalize')){assert.equal(stored.state,'complete');finalizes++;if(loseFinalResponse){loseFinalResponse=false;return send({error:{code:'temporary',message:'最终回执暂未送达'}},503);}return send({version:1,batch,...spec,state:'queued',stage:'processing',sourceCount:1,bookIds:[],message:'文件已上传，等待云端整理。'});}
     if(url.pathname.endsWith('/failed'))return send({failed:true});
     return send({version:1,batch,...spec,state:ready?'ready':'queued',stage:ready?'ready':'processing',sourceCount:1,bookIds:ready?['upload-999']:[],message:ready?'已入库':'文件已上传，等待云端整理。'});
    });
    await page.goto('http://127.0.0.1:8791/upload.html#pair='+'p'.repeat(43),{waitUntil:'networkidle'});
    await page.waitForFunction(()=>document.querySelector('#directOwnerState').textContent.includes('等待接口连接授权'));
    await page.locator('#directFiles').setInputFiles({name:'先选.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF prepare')});
    assert.equal(await page.locator('#directFileList li').count(),1);assert.equal(await page.locator('#startNewUpload').isDisabled(),true);
    serviceReady=true;await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    try{await page.waitForFunction(()=>document.querySelector('#directOwnerState').textContent.includes('私有资料库已连接'),{},{timeout:8000});}
    catch(error){console.log({owner:await page.locator('#directOwnerState').innerText(),automation:await page.locator('#automationState').innerText(),errors});throw error;}
    assert.equal(pairCalls,0,'an already enabled browser must not consume the single-use link again');
    assert.equal(await page.locator('#directFileList li').count(),1);await page.getByRole('button',{name:'移除 先选.pdf',exact:true}).click();
    assert.equal(await page.locator('#directFiles').isEnabled(),true);
    const big=Buffer.alloc(8*1024*1024+543,7);big.write('%PDF-1.7\n');
    await page.locator('#directFiles').setInputFiles({name:'物理课件.pdf',mimeType:'application/pdf',buffer:big});
    await page.locator('#directFiles').setInputFiles([{name:'重复内容.pdf',mimeType:'application/pdf',buffer:big},{name:'移除.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF remove')}]);
    assert.equal(await page.locator('#directFileList li').count(),3);
    await page.getByRole('button',{name:'移除 移除.pdf',exact:true}).click();assert.equal(await page.locator('#directFileList li').count(),2);
    await page.locator('#uploadCategories input[value=university-physics]').check();await page.locator('#uploadTags').fill('深中高中物理资料');
    await page.locator('#startNewUpload').click();
    try{await page.waitForFunction(()=>document.querySelector('#directUploadState').textContent.includes('服务器正在校验'),{},{timeout:10000});}
    catch(error){console.log({state:await page.locator('#directUploadState').innerText(),notice:await page.locator('#newUploadNotice').innerText(),puts,errors});throw error;}
    assert.equal(await page.locator('#pendingUploads li').count(),0,'100% sent must not create a success or processing receipt before server verification');
    assert.equal(await page.locator('#completedUploads li').count(),0);assert.equal(await page.locator('#directUploadProgress').evaluate(progress=>progress.value),100);
    allowVerified=true;
    await page.waitForFunction(()=>document.querySelector('#directUploadState').textContent.includes('上传成功，服务器已收齐'));
    assert.equal(puts,2,'the stored first part must not be retransmitted after its failed response');
    assert.equal(finalizes,1,'a lost final response must be reconciled from server status without restarting the batch');
    assert.deepEqual(spec.cats,['high-school-physics','university-physics']);assert.equal(spec.expectedCount,1);assert.deepEqual(spec.tags,['深中高中物理资料']);
    assert.equal(await page.locator('#directFileList li').count(),0);assert.equal(await page.locator('#pendingUploads li').count(),1);assert.equal(context.pages().length,1,'upload must stay on the original page');
    ready=true;await page.locator('#refreshUploadStatus').click();await page.waitForFunction(()=>document.querySelector('#completedUploads').children.length===1);
    assert.equal(await page.locator('#pendingUploads li').count(),0);assert.equal(await page.locator('#completedUploads a').count(),2);
    failedMode=true;ready=false;puts=0;
    await page.locator('#directFiles').setInputFiles({name:'失败.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF failure')});
    await page.locator('#startNewUpload').click();await page.waitForFunction(()=>document.querySelector('#directUploadState').textContent.includes('HTTP 403'));
    assert.equal(puts,1);assert.equal(await page.locator('#pendingUploads li').count(),0);
    await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('#pendingUploads li').count(),0);assert.equal(await page.locator('#directFileList li').count(),0);
    for(const scheme of ['light','dark']){
     await page.emulateMedia({colorScheme:scheme});assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
     for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
    }
    await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'light'});await page.screenshot({path:`/tmp/direct-upload-${name}.png`,fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(`PASS ${name}: original-page File picker, cumulative selection/removal, multi-category metadata, real File hashing and XHR part payloads, ack-loss reconciliation, verified success, failure clearing, mobile layout and accessibility. Service responses are fixtures.`);
   }finally{await browser.close();}
  }
 }finally{server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
