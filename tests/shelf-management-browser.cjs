const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),path=require('node:path'),{chromium,firefox}=require('playwright');
const data=require('../books.json'),endpoint='https://nicole-private-book-upload.vibrantcloth2.chatgpt.site',token='a'.repeat(43);
const math=data.books.find(b=>b.id==='upload-737626449'),finance=data.books.find(b=>b.id==='qf-quanttrading');assert(math&&finance);
const fixture={...data,books:[math,finance]};
(async()=>{const server=spawn('python3',['-m','http.server','8774','--bind','127.0.0.1'],{cwd:path.join(__dirname,'..'),stdio:'ignore'});try{
 for(let n=0;n<30;n++){try{if((await fetch('http://127.0.0.1:8774/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 for(const [engine,type]of Object.entries({chromium,firefox})){
  const browser=await type.launch({headless:true});let removed=new Set(),expired=false,mutations=0,failVisibility=false;
  const contexts=[];const context=async(owner=false)=>{
   const c=await browser.newContext({viewport:{width:390,height:844}});contexts.push(c);if(owner)await c.addInitScript(t=>localStorage.setItem('nicole-direct-session-v1',JSON.stringify({token:t,scope:'owner',expires:Date.now()/1000+600})),token);
   await c.route('**/books.json',route=>route.fulfill({json:fixture}));await c.route('**/upload-service.json',route=>route.fulfill({json:{version:1,ready:true,managementReady:true,endpoint}}));
   await c.route(endpoint+'/**',async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method(),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS'};
    const reply=(json,status=200)=>route.fulfill({json,status,headers});
    if(method==='OPTIONS')return route.fulfill({status:204,headers});
    if(url.pathname==='/library-state'){if(failVisibility)return route.abort('failed');return reply({version:1,removedIds:[...removed]});}
    if(expired||req.headers().authorization!=='Bearer '+token)return reply({error:{code:'session_expired',message:'请重新登录 GitHub。'}},401);
    if(url.pathname==='/api/session')return reply({connected:true,scope:'owner'});
    if(url.pathname==='/api/library')return reply({trash:[...removed].map(id=>({id,title:math.title,author:math.author,deletedAt:1}))});
    assert(url.pathname.includes(math.id),'No finance mutation is allowed in this test');
    if(method==='DELETE'){assert.deepEqual(req.postDataJSON(),{confirm:true,title:math.title});removed.add(math.id);mutations++;return reply({id:math.id,deleted:true,originalRetained:true});}
    if(method==='POST'&&url.pathname.endsWith('/restore')){removed.delete(math.id);mutations++;return reply({id:math.id,restored:true});}
    return reply({error:{message:'Unexpected request'}},404);
   });return c;
  };
  try{
   const visitor=await(await context()).newPage();await visitor.goto('http://127.0.0.1:8774/');await visitor.waitForSelector('.book');assert.equal(await visitor.locator('.delete-book').count(),0);
   const c=await context(true),page=await c.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8774/');await page.waitForSelector('.book');assert.equal(await page.locator('.delete-book').count(),0);
   await page.locator('#manageShelf').click();await page.waitForSelector('.delete-book');const target=page.locator(`.book[data-id="${math.id}"]`);
   await target.locator('.delete-book').click();assert((await page.locator('#deleteBookName').innerText()).includes(math.title));await page.locator('#deleteCancel').click();assert.equal(mutations,0);
   await target.locator('.delete-book').click();await page.locator('#deleteConfirm').click();await page.waitForFunction(id=>!document.querySelector(`.book[data-id="${id}"]`),math.id);assert.equal(await page.locator('.book').count(),1);assert.equal(mutations,1);assert((await page.locator('#totalSummary').innerText()).startsWith('1 份资料'));
   const fresh=await(await context()).newPage();await fresh.goto('http://127.0.0.1:8774/');await fresh.waitForSelector('.book');assert.equal(await fresh.locator(`[data-id="${math.id}"]`).count(),0);assert.equal(await fresh.locator('.delete-book').count(),0);
   assert.equal(await page.locator(`.book[data-id="${finance.id}"] .owner-download`).getAttribute('href'),finance.ownerAccess.download);
   await page.locator('#openTrash').click();await page.getByRole('button',{name:`恢复《${math.title}》`,exact:true}).click();await page.waitForFunction(id=>!!document.querySelector(`.book[data-id="${id}"]`),math.id);await page.locator('#trashClose').click();assert.equal(await page.locator('.book').count(),2);assert.equal(mutations,2);
   assert.equal(await target.locator('.owner-download').getAttribute('href'),math.ownerAccess.download);
   expired=true;await target.locator('.delete-book').click();await page.locator('#deleteConfirm').click();await page.waitForFunction(()=>document.querySelector('#deleteError').textContent.includes('GitHub'));assert.equal(await page.locator('.delete-book').count(),0);assert.equal(mutations,2);await page.locator('#deleteCancel').click();
   failVisibility=true;const offline=await(await context()).newPage();await offline.goto('http://127.0.0.1:8774/');await offline.waitForSelector('#loadError:visible');assert.equal(await offline.locator('.book').count(),0);failVisibility=false;await offline.locator('#retryLoad').click();await offline.waitForSelector('.book');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);console.log(`PASS ${engine}: visitor protection, confirmed global removal, cancellation, restore, finance unchanged, expiry and failed-state recovery.`);
  }finally{for(const c of contexts)await c.close();await browser.close();}
 }
}finally{server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
