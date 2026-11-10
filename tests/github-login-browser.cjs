const assert=require('node:assert/strict');
const {chromium,firefox}=require('playwright');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const path=require('node:path');
const origin='http://127.0.0.1:8797',service='https://nicole-private-book-upload.vibrantcloth2.chatgpt.site';
(async()=>{
 const server=spawn('python3',['-m','http.server','8797','--bind','127.0.0.1'],{cwd:path.join(__dirname,'..'),stdio:'ignore'});
 try{
  for(let i=0;i<30;i++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  for(const [name,type] of Object.entries({chromium,firefox})){
   const browser=await type.launch();
   try{
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
    const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
    let challenge,sessionToken,holdHealth=false,releaseHealth;
    const healthGate=new Promise(resolve=>{releaseHealth=resolve;});
    const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json'};
    await context.route(service+'/**',async route=>{
     const req=route.request(),url=new URL(req.url()),send=(data,status=200)=>route.fulfill({status,headers:cors,body:JSON.stringify(data)});
     if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
     if(url.pathname==='/health'){if(holdHealth&&req.frame().page()===page)await healthGate;return send({archiveReady:true,githubLoginReady:true});}
     if(url.pathname==='/api/session')return sessionToken&&req.headers().authorization==='Bearer '+sessionToken?send({connected:true}):send({error:{code:'session_required',message:'请先登录'}},401);
     if(url.pathname==='/api/batches')return send({batches:[]});
     if(url.pathname==='/auth/github/start'||url.pathname==='/auth/github/bootstrap'){
      const body=req.postDataJSON();challenge=body.challenge;assert.match(challenge,/^[A-Za-z0-9_-]{43}$/);if(url.pathname.endsWith('bootstrap'))assert.equal(body.key,'s'.repeat(43));return send({url:service+'/auth/github/'+(url.pathname.endsWith('bootstrap')?'setup':'authorize')+'?state=browser-fixture'});
     }
     if(['/auth/github/authorize','/auth/github/setup'].includes(url.pathname))return route.fulfill({status:303,headers:{Location:origin+'/upload.html#github='+'g'.repeat(43)+'&challenge='+challenge}});
     if(url.pathname==='/auth/github/complete'){
      const body=req.postDataJSON();assert.equal(createHash('sha256').update(body.verifier).digest('base64url'),challenge);assert.equal(body.grant,'g'.repeat(43));assert.match(body.clientToken,/^[A-Za-z0-9_-]{43}$/);sessionToken=body.clientToken;return send({token:sessionToken,scope:'owner',expires:Date.now()/1000+86400});
     }
     throw new Error('Unexpected service route '+url.pathname);
    });
    await page.goto(origin+'/upload.html',{waitUntil:'networkidle'});
    await page.locator('#directFiles').setInputFiles({name:'手机原文件.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nbook')});
    holdHealth=true;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await page.locator('#githubLogin').click({timeout:5000});
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('nicole-direct-session-v1')||'null')?.token,{},{timeout:10000});
    holdHealth=false;releaseHealth();
    await page.waitForFunction(()=>document.querySelector('#directOwnerState').textContent.includes('私有资料库已连接'),{},{timeout:15000});
    assert.equal(await page.locator('#directFileList li').count(),1,'the original selected phone File survives sign-in');
    assert.equal(await page.locator('#startNewUpload').isEnabled(),true);
    assert.equal(new URL(page.url()).origin,origin);assert.deepEqual(errors,[]);
    assert.equal(await page.locator('#directActivation').isVisible(),false);
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('nicole-direct-session-v1')));assert.equal(saved.token,sessionToken);assert.equal(saved.scope,'owner');
    await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('#directOwnerState').textContent.includes('私有资料库已连接'));
    await page.evaluate(()=>localStorage.clear());sessionToken=undefined;
    await page.goto(origin+'/upload.html?first-github-connection=1#githubSetup='+'s'.repeat(43),{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#directOwnerState').textContent.includes('私有资料库已连接'),{},{timeout:15000});
    assert.equal(new URL(page.url()).hash,'');assert.deepEqual(errors,[]);
    console.log('PASS '+name+': GitHub login returns to the original uploader, verifies the one-use browser proof, preserves selected phone files, enables Start and persists the session. GitHub and receiver responses are fixtures.');
   }finally{await browser.close();}
  }
 }finally{server.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
