const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium, firefox} = require('playwright');
const helper = fs.readFileSync(path.join(__dirname,'../tools/github-upload-helper.user.js'),'utf8');
const prefix='/Nicole8206929/study-materials-originals/releases';
const edit=`https://github.com${prefix}/edit/untagged-fixture`;
const component=path.join(__dirname,'../node_modules/@github/file-attachment-element/dist');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Native upload fixture</title></head><body>
<main><h1>Edit release</h1><form class="js-release-form"><input id="release_id" type="hidden" value="438226489">
<label>Title<input id="release_name" type="text" value="书籍上传区"></label><label>Body<textarea id="release_body">Fixture</textarea></label>
<div id="native-rows"></div><file-attachment input="release-files" class="js-upload-release-file"><input id="release-files" type="file" multiple><p>Attach binaries</p></file-attachment>
<button type="button" id="save">Save draft</button><button type="button" id="publish">Publish release</button></form></main>
<script type="module" src="/helper-fixture/native.js"></script></body></html>`;
const native=`import Element from '/helper-fixture/file-attachment-element.js';
if(!customElements.get('file-attachment'))customElements.define('file-attachment',Element);
const form=document.querySelector('form');
const config=await(await fetch('/helper-fixture/state')).json();
const rows=document.querySelector('#native-rows');
for(const f of config.assets){const row=document.createElement('div');row.className='existing';const input=document.createElement('input');input.type='text';input.value=f.name;row.append(input);rows.append(row);}
document.addEventListener('file-attachment-accepted',async e=>{
 for(const attachment of e.detail.attachments){
  const f=attachment.file;attachment.saving(0);
  const response=await fetch('/helper-fixture/upload',{method:'POST',body:JSON.stringify({name:f.name,size:f.size})});
  if(!response.ok){
   const row=document.createElement('div');row.className='is-failed';row.dataset.state='failed';
   const input=document.createElement('input');input.type='text';input.value=f.name;
   const message=document.createElement('p');message.textContent='Upload failed. Delete and try uploading this file again.';
   const remove=document.createElement('button');remove.type='button';remove.textContent=config.unsafeRemove?'Ignore':'×';
   if(!config.unsafeRemove)remove.setAttribute('aria-label','Remove this failed file');
   remove.addEventListener('click',async()=>{await fetch('/helper-fixture/remove',{method:'POST',body:JSON.stringify({name:f.name})});row.remove();});
   row.append(input,message,remove);rows.append(row);
   e.target.dispatchEvent(new CustomEvent('upload:error',{bubbles:true,detail:{attachment}}));
  }else{
   attachment.saved({name:f.name,id:response.headers.get('x-asset-id')});
   if(config.editBody)document.querySelector('#release_body').value='Manual change';
   e.target.dispatchEvent(new CustomEvent('upload:complete',{bubbles:true,detail:{attachment}}));
  }
 }
});
document.querySelector('#save').addEventListener('click',async()=>{await fetch('/helper-fixture/save',{method:'POST'});form.dispatchEvent(new CustomEvent('release:saved',{bubbles:true,detail:{release:{id:438226489}}}));});
document.querySelector('#publish').addEventListener('click',()=>fetch('/helper-fixture/publish',{method:'POST'}));
window.nativeReady=true;`;

async function fixture(browser, options={}) {
  const assets=new Map(Object.entries(options.initial||{}).map(([name,size])=>[name,{name,size,state:'uploaded'}]));
  for(const name of options.starters||[]) assets.set(name,{name,size:3,state:'starter'});
  const state={assets,uploads:[],deletes:[],saves:0,publishes:0,active:0,maxActive:0,heads:0};
  const failures={...options.failures};
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),p=url.pathname;
    if(url.hostname!=='github.com')return route.fulfill({status:404,body:''});
    if(p.includes('/releases/edit/'))return route.fulfill({contentType:'text/html',body:html});
    if(p.startsWith(`${prefix}/tag/`)){
      if(options.login)return route.fulfill({status:403,body:'Sign in'});
      const body=options.brokenIndex?'<html><body>unexpected page</body></html>':`<include-fragment src="${prefix}/expanded_assets/untagged-fixture"></include-fragment>`;
      return route.fulfill({contentType:'text/html',body});
    }
    if(p.startsWith(`${prefix}/expanded_assets/`)){
      const body=[...assets.values()].map(f=>`<a href="${prefix}/download/untagged-fixture/${encodeURIComponent(f.name)}">asset</a>`).join('');
      return route.fulfill({contentType:'text/html',body});
    }
    if(p.startsWith(`${prefix}/download/`)){
      state.heads++;
      const asset=assets.get(decodeURIComponent(p.split('/').pop()));
      if(!asset||asset.state!=='uploaded')return route.fulfill({status:404,body:''});
      return route.fulfill({status:200,headers:{'content-length':String(asset.size),'content-type':'application/octet-stream'},body:''});
    }
    if(p==='/helper-fixture/native.js')return route.fulfill({contentType:'text/javascript',body:native});
    if(p==='/helper-fixture/state')return route.fulfill({json:{assets:[...assets.values()],unsafeRemove:!!options.unsafeRemove,editBody:!!options.editBody}});
    if(p==='/helper-fixture/upload'){
      const f=req.postDataJSON();state.uploads.push(f.name);state.active++;state.maxActive=Math.max(state.maxActive,state.active);
      await new Promise(resolve=>setTimeout(resolve,5));state.active--;
      if(failures[f.name]){failures[f.name]--;assets.set(f.name,{...f,state:options.lostResponse?'uploaded':'starter'});return route.fulfill({status:500,body:'failed'});}
      if(assets.has(f.name))return route.fulfill({status:422,body:'duplicate'});
      assets.set(f.name,{...f,state:'uploaded'});return route.fulfill({status:201,headers:{'x-asset-id':'123'},body:'uploaded'});
    }
    if(p==='/helper-fixture/remove'){const {name}=req.postDataJSON();state.deletes.push(name);assets.delete(name);return route.fulfill({status:204,body:''});}
    if(p==='/helper-fixture/save'){state.saves++;return route.fulfill({status:200,body:'saved'});}
    if(p==='/helper-fixture/publish'){state.publishes++;return route.fulfill({status:200,body:'published'});}
    if(p.startsWith('/helper-fixture/')){
      let name=path.basename(p);if(!name.endsWith('.js'))name+='.js';
      const file=path.join(component,name);
      if(fs.existsSync(file)){
        const delay=options.delayElement&&name==='file-attachment-element.js'?'await new Promise(r=>setTimeout(r,200));\n':'';
        return route.fulfill({contentType:'text/javascript',body:delay+fs.readFileSync(file,'utf8')});
      }
    }
    return route.fulfill({status:404,body:''});
  });
  await context.addInitScript(()=>{
    const timer=window.setTimeout.bind(window);
    window.setTimeout=(fn,ms,...args)=>timer(fn,[1500,4000,10000,1200,2400].includes(ms)?1:ms,...args);
    window.GM_addStyle=css=>{const s=document.createElement('style');s.textContent=css;document.head.append(s);};
    window.GM_setValue=()=>{};window.GM_getValue=()=>null;window.unsafeWindow=window;
    window.GM_xmlhttpRequest=options=>fetch(options.url,{method:options.method,headers:options.headers}).then(async response=>{
      options.onload({status:response.status,finalUrl:response.url,responseText:options.method==='HEAD'?'':await response.text(),responseHeaders:[...response.headers].map(([k,v])=>k+': '+v).join('\r\n')});
    }).catch(options.onerror);
  });
  await context.addInitScript({content:helper});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(edit);
  try { await page.waitForFunction(()=>window.nativeReady===true); }
  catch(error) { throw new Error('Native fixture not ready: '+errors.join('; ')+'; '+await page.locator('body').innerText()); }
  await page.waitForSelector('#nicole-upload-helper');
  const choose=async names=>{
    await page.locator('#release-files').setInputFiles(names.map(name=>({name,mimeType:'application/octet-stream',buffer:Buffer.from('abc')})));
  };
  return {page,state,choose,errors,close:()=>context.close()};
}

(async()=>{
  for(const engine of [chromium,firefox]){
    const browser=await engine.launch({headless:true});
    try{
      let f=await fixture(browser,{initial:{'old.pdf':3}});
      await f.choose(['old.pdf','new.pptx','third.pdf']);
      await f.page.waitForFunction(()=>/已提交|已保存草稿/.test(document.querySelector('#nicole-upload-helper [role=status]').textContent));
      assert.deepEqual(f.state.uploads,['new.pptx','third.pdf']);assert.equal(f.state.saves,1);assert.equal(f.state.publishes,0);assert.equal(f.state.maxActive,1);
      assert((await f.page.locator('#nicole-upload-helper').innerText()).includes('已跳过 1'));
      assert.deepEqual(f.errors,[]);
      await f.page.reload();await f.page.waitForFunction(()=>window.nativeReady===true);await f.choose(['old.pdf','new.pptx','third.pdf']);
      await f.page.waitForFunction(()=>document.querySelector('#nicole-upload-helper [role=status]').textContent.includes('无须重复'));
      assert.deepEqual(f.state.uploads,['new.pptx','third.pdf']);await f.close();

      f=await fixture(browser,{initial:{'safe.pdf':3},failures:{'retry.pdf':1}});
      await f.choose(['safe.pdf','retry.pdf']);
      await f.page.waitForFunction(()=>/已提交|已保存草稿/.test(document.querySelector('#nicole-upload-helper [role=status]').textContent));
      assert.deepEqual(f.state.uploads,['retry.pdf','retry.pdf']);assert.deepEqual(f.state.deletes,['retry.pdf']);assert(f.state.assets.has('safe.pdf'));assert.deepEqual(f.errors,[]);await f.close();

      f=await fixture(browser,{failures:{'limit.pdf':4}});await f.choose(['limit.pdf']);
      await f.page.waitForFunction(()=>{const panel=document.querySelector('#nicole-upload-helper');return panel.textContent.includes('失败 1')&&!panel.querySelector('button').disabled;});
      await f.page.getByRole('button',{name:'重试失败项',exact:true}).click();
      await f.page.waitForFunction(()=>document.querySelector('#nicole-upload-helper [role=status]').textContent.includes('已保存草稿'));
      assert.equal(f.state.uploads.length,5);assert.equal(f.state.deletes.length,4);assert.equal(f.state.saves,1);await f.close();

      f=await fixture(browser,{initial:{'safe.pdf':3},failures:{'unsafe.pdf':1},unsafeRemove:true});
      await f.choose(['safe.pdf','unsafe.pdf','later.pdf']);
      await f.page.waitForFunction(()=>document.querySelector('#nicole-upload-helper [role=status]').textContent.includes('移除按钮'));
      assert.deepEqual(f.state.uploads,['unsafe.pdf']);assert.deepEqual(f.state.deletes,[]);assert(f.state.assets.has('safe.pdf'));await f.close();

      f=await fixture(browser,{failures:{'received.pdf':1},lostResponse:true});await f.choose(['received.pdf']);
      await f.page.waitForFunction(()=>document.querySelector('#nicole-upload-helper [role=status]').textContent.includes('同名附件已完整存在'));
      assert.deepEqual(f.state.deletes,[]);assert.equal(f.state.assets.get('received.pdf').state,'uploaded');await f.close();

      f=await fixture(browser,{initial:{'changed.pdf':99}});await f.choose(['changed.pdf']);
      await f.page.waitForFunction(()=>document.querySelector('#nicole-upload-helper').textContent.includes('冲突 1'));
      assert.deepEqual(f.state.uploads,[]);assert.deepEqual(f.state.deletes,[]);await f.close();

      f=await fixture(browser,{initial:{'safe.pdf':3},brokenIndex:true});await f.choose(['safe.pdf','new.pdf']);
      await f.page.waitForFunction(()=>document.querySelector('#nicole-upload-helper [role=status]').textContent.includes('尚未识别成功'));
      assert.deepEqual(f.state.uploads,[]);assert.deepEqual(f.state.deletes,[]);await f.close();

      f=await fixture(browser,{starters:['pending.pdf']});await f.choose(['pending.pdf','later.pdf']);
      await f.page.waitForFunction(()=>document.querySelector('#nicole-upload-helper [role=status]').textContent.includes('无法确认同名附件'));
      assert.deepEqual(f.state.uploads,[]);assert.deepEqual(f.state.deletes,[]);await f.close();

      f=await fixture(browser,{editBody:true});await f.choose(['new.pdf']);
      await f.page.waitForFunction(()=>document.querySelector('#nicole-upload-helper [role=status]').textContent.includes('手动改过'));
      assert.equal(f.state.saves,0);assert.equal(f.state.publishes,0);await f.close();

      f=await fixture(browser,{login:true});await f.choose(['new.pdf']);
      await f.page.waitForFunction(()=>document.querySelector('#nicole-upload-helper [role=status]').textContent.includes('登录本人的 GitHub'));
      assert.deepEqual(f.state.uploads,[]);assert.deepEqual(f.state.deletes,[]);await f.close();

      f=await fixture(browser,{initial:{'safe.pdf':3},delayElement:true});await f.choose(['safe.pdf']);
      try { await f.page.waitForFunction(()=>document.querySelector('#nicole-upload-helper [role=status]').textContent.includes('无须重复'),null,{timeout:5000}); }
      catch(error) {
        const nativeInfo=await f.page.evaluate(()=>{const e=document.querySelector('file-attachment');return {constructor:e.constructor.name,registered:customElements.get('file-attachment')?.name,attach:typeof e.attach,connected:e.isConnected,id:document.querySelector('#release_id').value};});
        throw new Error('Delayed control: '+await f.page.locator('#nicole-upload-helper').innerText()+'; native='+JSON.stringify(nativeInfo)+'; errors='+f.errors.join('; ')+'; uploads='+JSON.stringify(f.state.uploads));
      }
      assert.deepEqual(f.state.uploads,[]);assert.deepEqual(f.errors,[]);await f.close();
      console.log(`PASS ${engine.name()}: native GitHub file-attachment component, reselect/skip, serial upload, safe failure retry, conflicts, stale placeholders, page reload and draft safety.`);
    }finally{await browser.close();}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
