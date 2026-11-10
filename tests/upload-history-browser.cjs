const assert=require('node:assert/strict');
const {chromium,firefox}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
(async()=>{
 const server=spawn('python3',['-m','http.server','8790','--bind','127.0.0.1'],{cwd:path.join(__dirname,'..'),stdio:'ignore'});
 try{
  for(let i=0;i<30;i++){try{if((await fetch('http://127.0.0.1:8790/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  for(const [name,type] of Object.entries({chromium,firefox})){
   const browser=await type.launch();
   try{
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.route('**/upload-service.json',r=>r.fulfill({json:{version:1,ready:false}}));
    const batches=['upload-20261110032658-bb88991b181ca6b4','upload-20261110035947-76d9bd27b8090eba','upload-20261110123456-1234abcd','upload-20261110123457-1234abcd'];
    await context.addInitScript(({batches})=>{
     if(!localStorage.getItem('history-fixture-ready')){
      localStorage.setItem('history-fixture-ready','yes');
      localStorage.setItem('nicole-library-pending-v1',JSON.stringify(batches.map(batch=>({batch,cat:'high-school-physics'}))));
     }
    },{batches});
    const page=await context.newPage(),mutations=[];
    page.on('request',r=>{if(r.method()!=='GET')mutations.push(r.method()+' '+r.url());});
    await page.route('**/upload-status/**',r=>{
     const batch=new URL(r.request().url()).pathname.split('/').pop().replace(/\.json$/,'');
     if(batch===batches[3])return r.fulfill({status:404,body:'No processing receipt yet'});
     return r.fulfill({json:{version:1,batch,cat:'high-school-physics',sourceCount:0,bookIds:[],stage:batch===batches[2]?'processing':'failed',message:batch===batches[2]?'正在处理真实任务':'附件上传失败，本批已关闭。'}});
    });
    await page.goto('http://127.0.0.1:8790/upload.html',{waitUntil:'networkidle'});
    assert.equal(await page.locator('#pendingUploads li').count(),2,'confirmed failures must leave the unfinished list, while processing and unknown batches stay');
    assert.equal(await page.locator('#completedUploads li').count(),0);
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('nicole-library-pending-v1')));
    assert.deepEqual(saved.map(x=>x.batch),batches.slice(2));
    await page.reload({waitUntil:'networkidle'});
    assert.equal(await page.locator('#pendingUploads li').count(),2);
    await page.getByRole('button',{name:'移除此条未完成记录'}).first().click();
    assert.equal(await page.locator('#pendingUploads li').count(),1);
    await page.getByRole('button',{name:'移除此条未完成记录'}).click();
    assert.equal(await page.locator('#pendingUploads li').count(),0);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('nicole-library-pending-v1'))),[]);
    assert.deepEqual(mutations,[],'dismissal must not delete private files or cancel a real cloud task');
    await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('#pendingUploads li').count(),0);
    console.log(`PASS ${name}: confirmed failed batches clear after refresh, genuine processing and unknown status are retained, dismissals persist without deleting source files.`);
   }finally{await browser.close();}
  }
 }finally{server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
