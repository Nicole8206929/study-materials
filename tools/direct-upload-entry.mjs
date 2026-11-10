import {DirectUploadClient,UploadFailure} from './direct-upload-client.mjs';
import {makeUploadRelease} from './library-upload.mjs';
import {screenActivity} from './screen-activity.mjs';
import {initializeGithubLogin} from './github-login.mjs';
const tokenKey='nicole-direct-session-v1',pairKey='nicole-direct-pair-v1',activeKey='nicole-direct-active-v1',failedKey='nicole-direct-failed-v1';
const read=(key,fallback=null)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
const write=(key,value)=>{try{value===null?localStorage.removeItem(key):localStorage.setItem(key,JSON.stringify(value));}catch{}};
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const label=bytes=>`${(bytes/1024/1024).toFixed(1)} MB`;
export function initializeDirectUpload({config,authorizationUrl=location.href,categories,input,onQueued,notify}){
 const el=id=>document.getElementById(id),endpoint=new URL(config.endpoint).origin;
 const entry=new URL(authorizationUrl),connectRequested=entry.searchParams.get('connect')==='github'||new URLSearchParams(entry.hash.slice(1)).has('githubSetup');
 window.nicoleDirectUploaderStarted=true;
 let enabled=config.ready===true,auth=read(tokenKey),rows=[],busy=false,authRefreshing=false,authRefreshRequested=false,archiveReady=false,githubReady=false,connected=false,controller,login,active=read(activeKey);
 const client=new DirectUploadClient({endpoint,token:()=>auth?.token||''});
 const activity=screenActivity({request:navigator.wakeLock?.request?()=>navigator.wakeLock.request('screen'):null,visible:()=>document.visibilityState==='visible',notify:text=>{el('directBackground').textContent=text;}});
 const names={selected:'待上传',checking:'正在本地核对',uploading:'正在上传',retrying:'正在核对并重试',verifying:'服务器正在校验',complete:'服务器已校验',duplicate:'内容重复，已跳过',failed:'未完成，可重试'};
 function updateButton(){el('startNewUpload').textContent=connected?'开始上传':githubReady?'GitHub 登录':'连接 GitHub';el('startNewUpload').disabled=!enabled||busy||(connected&&!rows.length);if(busy)for(const id of ['uploadCategories','uploadSubcategories'])el(id).querySelectorAll('input').forEach(item=>{item.disabled=true;});}
 function renderRows(){
  el('directSelectionCount').textContent=rows.length?`已选 ${rows.length} 份，可继续添加`:'尚未选择文件';
  el('directFileList').replaceChildren(...rows.map((row,index)=>{
   const li=document.createElement('li'),body=document.createElement('div'),name=document.createElement('p'),status=document.createElement('p'),remove=document.createElement('button');
   name.textContent=row.file.name;status.className='muted';status.textContent=`${label(row.file.size)} · ${names[row.state]||row.state}${row.sent?` · 已发送 ${label(Math.min(row.sent,row.file.size))}`:''}`;
   body.append(name,status);remove.type='button';remove.className='remove-selection';remove.textContent='×';remove.disabled=busy;remove.setAttribute('aria-label','移除 '+row.file.name);
   remove.addEventListener('click',()=>{rows.splice(index,1);renderRows();});li.append(body,remove);return li;
  }));updateButton();
 }
 function add(files){
  if(busy)return;
  for(const file of files){
   if(rows.some(r=>r.file.name===file.name&&r.file.size===file.size&&r.file.lastModified===file.lastModified))continue;
   if(!/\.(pdf|epub|ppt|pptx)$/i.test(file.name)||!file.size||file.size>=2*1024**3||/[\/\\\x00-\x1f]/.test(file.name)||file.name.length>240){notify(`无法添加“${file.name}”：请先完整保存 PDF、EPUB、PPT 或 PPTX，文件需小于 2 GiB。`);continue;}
   if(rows.length>=1000){notify('每批最多累计选择 1000 份文件。');break;}
   rows.push({file,state:'selected',sent:0});
  }renderRows();
 }
 function setBusy(value){
  busy=value;activity.setActive(value);el('cancelDirectUpload').hidden=!value;el('directFiles').disabled=value;
  for(const selector of ['#uploadCategories input','#uploadSubcategories input','#uploadTags','#uploadMode','#uploadTitle','#uploadExpected'])document.querySelectorAll(selector).forEach(item=>{item.disabled=value;});
  renderRows();
 }
 async function flushFailures(){
  const waiting=read(failedKey,[]),remaining=[];
  for(const item of waiting){try{await client.fail(item.batch,item);}catch{remaining.push(item);}}
  write(failedKey,remaining);
 }
 async function refreshAuth(){
  if(busy)return;
  if(authRefreshing){authRefreshRequested=true;return;}
  if(!enabled){el('directOwnerState').textContent='上传服务已部署，正在等待接口连接授权。可以先选择文件，尚未开始传输。';updateButton();return;}
  authRefreshing=true;
  try{
   auth=read(tokenKey);
   const pending=read(pairKey);
   connected=false;
   if(auth?.token){const usedToken=auth.token;try{const state=await client.request('/api/session');connected=state.connected===true;}catch(error){if(error.status!==401)throw error;const latest=read(tokenKey);if(latest?.token&&latest.token!==usedToken){auth=latest;authRefreshRequested=true;return;}auth=null;write(tokenKey,null);}}
   if(!connected&&pending){auth=await client.pair(pending.ticket,pending.token);write(tokenKey,auth);connected=true;}
   if(connected&&pending)write(pairKey,null);
   const health=await client.health();archiveReady=health.archiveReady===true;githubReady=health.githubLoginReady===true;
   el('githubLogin').hidden=connected&&(!connectRequested||githubReady);el('githubLogin').textContent=githubReady?'GitHub 登录':'连接 GitHub（首次）';
   el('directOwnerState').textContent=connected?(archiveReady?'本人上传已启用，私有资料库已连接。':auth.scope==='validation'?'传输验证会话：测试文件不会加入书架。':'本人身份已启用。还需连接一次私有资料库，以后直接在本页上传。'):githubReady?'用 GitHub 登录后即可上传，仅 Nicole8206929 账号有上传权限。访客仍可正常查看试读。':'点下方“连接 GitHub（首次）”，在 GitHub 确认已填好的登录应用。请使用 Nicole8206929 账号；完成后会返回本页。';
   el('connectPrivateArchive').hidden=!connected||archiveReady||auth?.scope==='validation';el('disconnectDirectUpload').hidden=!connected;el('directActivation').hidden=connected;
   if(connected){
    await flushFailures();
    const known=await client.request('/api/batches');
    for(const record of known.batches||[])if(['queued','archiving','processing'].includes(record.state))onQueued({...record,source:'direct'});
    if(active){
     try{
      const record=await client.status(active.batch);
      if(['failed','cancelled'].includes(record.state)){active=null;write(activeKey,null);notify('上次未完成的上传已移出记录，可以重新选择文件。');}
      else if(['queued','archiving','processing','ready'].includes(record.state)){onQueued({...record,source:'direct'});active=null;write(activeKey,null);}
      else notify('上次传输有部分文件尚未收齐。重新选择原文件后，可复用服务器已收到的分块。');
     }catch(error){if(error.status===404){active=null;write(activeKey,null);}else throw error;}
    }
   }
  }catch(error){
   if(error.status===401){connected=false;auth=null;write(tokenKey,null);}
   el('directOwnerState').textContent=error.message;el('directActivation').hidden=connected;
  }finally{authRefreshing=false;updateButton();if(authRefreshRequested){authRefreshRequested=false;queueMicrotask(refreshAuth);}}
 }
 function acceptLink(value){
  let link;try{link=new URL(value,location.href);}catch{throw new Error('本人启用链接不完整。');}
  if(link.origin!==location.origin||link.pathname!==location.pathname)throw new Error('请使用本书架的本人启用链接。');
  const ticket=new URLSearchParams(link.hash.slice(1)).get('pair');if(!/^[A-Za-z0-9_-]{43}$/.test(ticket||''))throw new Error('本人启用链接不完整。');
  const saved=read(pairKey);write(pairKey,saved?.ticket===ticket?saved:{ticket,token:random()});
 }
 async function start(){
  if(busy)return;
  if(!connected){await login.start({usePopup:rows.length>0});return;}
  if(!rows.length){notify('请先选择要上传的文件。');return;}
  const selected=input();
  if(selected.expectedCount&&Number(selected.expectedCount)!==rows.length){notify(`本批填写了 ${selected.expectedCount} 份，但只选了 ${rows.length} 份；请补齐或修改文件数。`);return;}
  try{makeUploadRelease({...selected,expectedCount:rows.length},categories());}catch(error){notify(error.message);return;}
  controller=new AbortController();const signal=controller.signal;setBusy(true);el('directProgressSection').hidden=false;
  let batch,finalizing=false;
  const finish=record=>{
   onQueued({...record,source:'direct'});active=null;write(activeKey,null);rows=[];el('directFiles').value='';renderRows();
   el('directUploadState').textContent='上传成功，服务器已收齐并校验文件。已进入自动整理队列（后台每 30 分钟检查），完成后会显示“已入库”。';notify('文件已上传并私有保存。可以关闭网页；后台会自动按所选分类整理。');
  };
  try{
   const unique=[],seen=new Set();let checked=0,last=0;
   for(const row of rows){
    row.state='checking';renderRows();
    row.sha256||=await client.hash(row.file,{signal,onProgress:bytes=>{if(performance.now()-last>150){last=performance.now();el('directUploadState').textContent=`正在本地核对 ${checked+1}/${rows.length}：${row.file.name}（${label(bytes)}）`;}}});
    const key=row.sha256+':'+row.file.size;if(seen.has(key))row.state='duplicate';else{seen.add(key);row.state='selected';unique.push(row);}checked++;
   }
   const prepared=makeUploadRelease({...selected,expectedCount:unique.length},categories());
   if(active){
    const status=await client.status(active.batch);
    if(['queued','archiving','processing','ready'].includes(status.state)){onQueued({...status,source:'direct'});active=null;write(activeKey,null);notify('上次文件已交给云端整理。本次所选文件尚未发送，可再次点击开始上传。');return;}
    if(status.state!=='uploading'||JSON.stringify(active.spec)!==JSON.stringify(prepared.spec)){if(status.state==='uploading')await client.cancel(active.batch);active=null;write(activeKey,null);}
   }
   batch=active?.batch||prepared.batch;active={batch,spec:prepared.spec};write(activeKey,active);
   await client.request('/api/batches',{method:'POST',body:active,signal});
   let completed=0;const total=unique.reduce((sum,row)=>sum+row.file.size,0);
   for(let index=0;index<unique.length;index++){
    const row=unique[index];last=0;
    await client.uploadFile(batch,row.file,{sha256:row.sha256,signal,onProgress:state=>{
     const changed=row.state!==state.state;row.state=state.state;row.sent=state.sent;
     el('directUploadProgress').value=Math.min(100,(completed+state.sent)/total*100);
     if(changed||performance.now()-last>150||state.state==='complete'||state.state==='retrying'){
      last=performance.now();el('directUploadState').textContent=`${names[state.state]} ${index+1}/${unique.length}：${row.file.name} · ${label(state.sent)} / ${label(row.file.size)}${state.attempt?` · 重试 ${state.attempt}/3`:''}`;renderRows();
     }
    }});completed+=row.file.size;
   }
   if(signal.aborted)throw signal.reason||new DOMException('已暂停','AbortError');
   el('directUploadState').textContent='服务器已校验全部文件，正在交给云端整理…';
   el('cancelDirectUpload').hidden=true;
   finalizing=true;
   const record=await client.request('/api/batches/'+encodeURIComponent(batch)+'/finalize',{method:'POST',body:{},signal});
   finish(record);
  }catch(error){
   batch||=active?.batch;
   if(finalizing&&batch&&error.name!=='AbortError'){
    let confirmed;try{confirmed=await client.status(batch);}catch{}
    if(confirmed&&['queued','archiving','processing','ready'].includes(confirmed.state)){finish(confirmed);return;}
    if(!confirmed&&error.retryable){el('directUploadState').textContent='文件已发送，暂未确认最终回执。恢复联网后会自动查询；现在不重复发送文件。';notify('正在等待服务器确认，尚未误报为上传失败或入库成功。');return;}
   }
   if(error.name==='AbortError'){
    if(batch){try{await client.cancel(batch);}catch{write(failedKey,[...read(failedKey,[]),{batch,code:'cancelled'}].slice(-20));}}
    el('directUploadState').textContent='已暂停。再次开始时会核对并复用已收到的分块。';
   }else{
    if(batch){try{await client.fail(batch,error);}catch{write(failedKey,[...read(failedKey,[]),{batch,code:error.code||'http_error',status:error.status||0,requestId:error.requestId||''}].slice(-20));}}
    const message=`${error.message}${error.status?`（HTTP ${error.status}）`:''}${error.requestId?` · 错误编号 ${error.requestId}`:''}`;
    el('directUploadState').textContent=message;notify(message);
    for(const row of rows)if(!['complete','duplicate'].includes(row.state))row.state='failed';
   }
   active=null;write(activeKey,null);
  }finally{setBusy(false);}
 }
 el('directFiles').addEventListener('change',()=>{add(el('directFiles').files);el('directFiles').value='';});
 el('githubLogin').addEventListener('click',()=>login.start({usePopup:rows.length>0}));
 el('cancelDirectUpload').addEventListener('click',()=>controller?.abort(new DOMException('已暂停','AbortError')));
 el('applyDirectActivation').addEventListener('click',async()=>{try{acceptLink(el('directActivationLink').value.trim());el('directActivationLink').value='';await refreshAuth();}catch(error){notify(error.message);}});
 el('connectPrivateArchive').addEventListener('click',async()=>{
  const popup=window.open('about:blank','_blank');
  try{
   const result=await client.request('/api/connect',{method:'POST',body:{}});
   if(result.connected){popup?.close();await refreshAuth();return;}
   const target=new URL(result.url);
   if(!(target.origin===endpoint&&target.pathname.startsWith('/setup/'))&&!(target.origin==='https://github.com'&&target.pathname.startsWith('/apps/')))throw new Error('资料库连接地址不正确。');
   el('resumePrivateArchive').href=target.href;el('resumePrivateArchive').hidden=false;if(popup)popup.location.replace(target.href);
   else notify('请点“打开资料库授权”，完成一次确认；无需复制令牌。');
  }catch(error){popup?.close();notify(error.message);}
 });
 el('disconnectDirectUpload').addEventListener('click',async()=>{if(busy)return;try{await client.request('/api/session',{method:'DELETE'});}catch{}auth=null;connected=false;write(tokenKey,null);await refreshAuth();});
 window.addEventListener('message',event=>{if(event.origin===endpoint&&event.data?.type==='nicole-upload-connected'||event.origin===location.origin&&event.data?.type==='nicole-github-login')refreshAuth();});
 window.addEventListener('storage',event=>{if(event.key===tokenKey||event.key===pairKey)refreshAuth();});
 window.addEventListener('online',()=>refreshAuth());window.addEventListener('pageshow',()=>refreshAuth());document.addEventListener('visibilitychange',()=>{activity.update();if(document.visibilityState==='visible')refreshAuth();});
 const fragment=new URLSearchParams(new URL(authorizationUrl).hash.slice(1));
 if(fragment.has('pair')){try{acceptLink(authorizationUrl);history.replaceState(null,'',location.pathname+location.search);}catch(error){notify(error.message);}}
 if(window.nicoleDirectEarlyFiles?.length){add(window.nicoleDirectEarlyFiles);window.nicoleDirectEarlyFiles=[];}
 if(el('directFiles').files.length)add(el('directFiles').files);
 el('directUploadControls').hidden=false;el('startNewUpload').textContent='开始上传';el('legacyUploadInstructions').hidden=true;renderRows();
 login=initializeGithubLogin({client,entryUrl:authorizationUrl,notify:message=>{el('githubLoginNotice').textContent=message;notify(message);},onContinue:target=>{el('githubContinue').hidden=!target;if(target)el('githubContinue').href=target;},onSession:session=>{auth=session;write(tokenKey,session);notify('GitHub 登录成功，本人上传已启用。');}});
 login.completion.then(()=>refreshAuth());
 return {start,updateButton,status:batch=>client.status(batch),configure:next=>{if(enabled!==next.ready){enabled=next.ready===true;refreshAuth();}updateButton();},get connected(){return connected;}};
}
