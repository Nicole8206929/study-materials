import {PrivateServiceClient} from './private-service-client.mjs';
import {initializeGithubLogin} from './github-login.mjs';
const endpoint='https://nicole-private-book-upload.vibrantcloth2.chatgpt.site';
const sessionKey='nicole-direct-session-v1';
const session=()=>{try{return JSON.parse(localStorage.getItem(sessionKey)||'null');}catch{return null;}};
export async function initializeShelfManagement({onChange,onModeChange}){
 const el=id=>document.getElementById(id);
 let enabled=false,owner=false,active=false,busy=false,awaitingLogin=false,selected=null,removed=new Set();
 const response=await fetch('upload-service.json',{cache:'no-cache'});if(!response.ok)throw new Error('书架设置暂时无法加载，请重试。');
 const config=await response.json();enabled=config.version===1&&config.managementReady===true&&config.endpoint===endpoint;
 if(!enabled)return {visibility:async()=>new Set(),canManage:false,remove(){}};
 const client=new PrivateServiceClient({endpoint,token:()=>session()?.token||''});
 const notify=message=>{el('managementNotice').textContent=message;el('managementNotice').hidden=!message;};
 const request=async(...args)=>{try{return await client.request(...args);}catch(error){if(['network','timeout'].includes(error.code))error.message='暂时无法连接书架管理，请稍后重试。书籍原件仍在私有归档。';throw error;}};
 const login=initializeGithubLogin({client,notify,onSession:value=>localStorage.setItem(sessionKey,JSON.stringify(value))});
 function controls(){
  el('manageShelf').hidden=!enabled;el('manageShelf').disabled=busy;el('manageShelf').textContent=active?'结束管理':'管理书架';el('manageShelf').setAttribute('aria-pressed',String(active));
  el('openTrash').hidden=!active;el('openTrash').textContent=`回收站（${removed.size}）`;
 }
 async function visibility(){
  if(!enabled)return new Set();
  const data=await request('/library-state',{anonymous:true});
  if(data.version!==1||!Array.isArray(data.removedIds)||data.removedIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id)))throw new Error('书架更新信息不完整，请刷新重试。');
  removed=new Set(data.removedIds);controls();return removed;
 }
 async function authorize(){
  owner=false;
  if(!session()?.token)return false;
  try{const result=await request('/api/session');owner=result.connected===true&&result.scope==='owner';}
  catch(error){if(error.status!==401)throw error;}
  return owner;
 }
 async function changed(){await visibility();await onChange(new Set(removed));}
 function end(){active=false;controls();onModeChange();}
 function permissionError(error){if(error.status===401||error.status===403){owner=false;end();}notify(error.message);}
 el('manageShelf').addEventListener('click',async()=>{
  if(active){end();notify('已结束管理。');return;}
  if(busy)return;busy=true;controls();
  try{
   if(!await authorize()){awaitingLogin=true;notify('请使用本人 GitHub 账号登录，完成后可在书架删除或恢复书籍。');await login.start({usePopup:true});return;}
   awaitingLogin=false;
   active=true;notify('管理模式已开启。删除后所有访客都将看不到该书，可在回收站恢复。');controls();onModeChange();
  }catch(error){permissionError(error);}finally{busy=false;controls();}
 });
 el('deleteCancel').addEventListener('click',()=>el('deleteBookDialog').close());
 el('deleteConfirm').addEventListener('click',async()=>{
  if(!selected||busy)return;busy=true;controls();el('deleteConfirm').disabled=true;el('deleteCancel').disabled=true;el('deleteConfirm').textContent='正在删除…';
  try{
   await request('/api/library/'+encodeURIComponent(selected.id),{method:'DELETE',body:{confirm:true,title:selected.title}});
   const title=selected.title;el('deleteBookDialog').close();selected=null;await changed();notify(`已删除《${title}》，可在回收站恢复。`);
  }catch(error){permissionError(error);el('deleteError').textContent=error.message;}
  finally{busy=false;controls();el('deleteConfirm').disabled=false;el('deleteCancel').disabled=false;el('deleteConfirm').textContent='删除书籍';}
 });
 async function renderTrash(){
  const data=await request('/api/library');
  if(!Array.isArray(data.trash))throw new Error('回收站暂时无法读取，请重试。');
  el('trashList').replaceChildren();el('trashEmpty').hidden=!!data.trash.length;
  for(const book of data.trash){
   const row=document.createElement('li'),body=document.createElement('div'),title=document.createElement('p'),author=document.createElement('p'),restore=document.createElement('button');
   title.textContent=book.title;author.textContent=book.author;author.className='muted';body.append(title,author);restore.type='button';restore.textContent='恢复';restore.setAttribute('aria-label',`恢复《${book.title}》`);
   restore.addEventListener('click',async()=>{if(busy)return;busy=true;restore.disabled=true;restore.textContent='正在恢复…';try{await request('/api/library/'+encodeURIComponent(book.id)+'/restore',{method:'POST',body:{}});await changed();await renderTrash();notify(`已恢复《${book.title}》。`);}catch(error){permissionError(error);el('trashError').textContent=error.message;}finally{busy=false;controls();restore.disabled=false;restore.textContent='恢复';}});
   row.append(body,restore);el('trashList').append(row);
  }
 }
 el('openTrash').addEventListener('click',async()=>{el('trashError').textContent='';el('trashDialog').showModal();try{await renderTrash();}catch(error){permissionError(error);el('trashError').textContent=error.message;}});
 el('trashClose').addEventListener('click',()=>el('trashDialog').close());
 async function finishLogin(){if(!awaitingLogin)return;try{if(await authorize()){awaitingLogin=false;active=true;controls();onModeChange();notify('GitHub 登录成功，可以管理书架。');}}catch(error){permissionError(error);}}
 window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.type==='nicole-github-login')finishLogin();});
 window.addEventListener('storage',event=>{if(event.key!==sessionKey)return;if(!event.newValue){owner=false;end();}else finishLogin();});
 controls();
 return {
  visibility,
  get canManage(){return enabled&&owner&&active;},
  remove(book){if(!owner||!active||busy)return;selected=book;el('deleteBookName').textContent=book.title;el('deleteError').textContent='';el('deleteBookDialog').showModal();el('deleteCancel').focus();},
 };
}
