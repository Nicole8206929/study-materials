import {makeUploadRelease,validateUploadStatus,batchPattern} from './library-upload.mjs';

export function initializeLibraryUpload() {
  const el=id=>document.getElementById(id);
  if (!el('newUploadForm')) return;
  const url=new URL(location.href);
  el('legacyChecker').open=url.searchParams.has('batch') || url.searchParams.has('legacy');
  let categories=[],ready=false,refreshing=false;
  const pendingKey='nicole-library-pending-v1',receiptsKey='nicole-library-receipts-v1';
  function read(key) {try {const rows=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(rows)?rows.filter(x=>batchPattern.test(x.batch)).slice(-20):[];}catch{return [];}}
  let pending=read(pendingKey),receipts=read(receiptsKey);
  function save(){try{localStorage.setItem(pendingKey,JSON.stringify(pending));localStorage.setItem(receiptsKey,JSON.stringify(receipts.slice(-5)));}catch{}}
  function row(item,done=false) {
    const li=document.createElement('li');
    const text=document.createElement('p');text.textContent=done?'上传成功，已入库。':item.message||'等待上传。请在 GitHub 添加文件，全部成功后点 Publish release，再返回此页。';li.append(text);
    const detail=document.createElement('p');detail.className='muted';detail.textContent=`批次 ${item.batch.replace('upload-','')}${item.sourceCount?` · ${item.sourceCount} 份资料`:''}`;li.append(detail);
    const link=document.createElement('a');link.href=done?`./?cat=${encodeURIComponent(item.cat)}`:'https://github.com/Nicole8206929/study-materials-originals/actions/workflows/auto-library.yml';
    link.textContent=done?'查看所选分类':'查看私有处理记录';link.rel='noreferrer';li.append(link);return li;
  }
  function render() {
    el('pendingUploads').replaceChildren(...pending.map(x=>row(x)));
    el('completedUploads').replaceChildren(...receipts.slice(-5).reverse().map(x=>row(x,true)));
    el('uploadTracking').hidden=!pending.length&&!receipts.length;
    el('pendingHeading').textContent=pending.length?`待处理 ${pending.length} 批`:'待处理列表已清空';
  }
  async function refresh() {
    if (refreshing || document.visibilityState==='hidden' || navigator.onLine===false) return;
    refreshing=true;
    try {
      for (const item of [...pending]) {
        try {
          const response=await fetch(`upload-status/${item.batch}.json?fresh=${Date.now()}`,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout?AbortSignal.timeout(15000):undefined});
          if (response.status===404) continue;
          if (!response.ok) throw new Error('记录暂时不可用，返回前台后会重试。');
          const record=validateUploadStatus(await response.json(),item.batch);
          if (record.stage==='ready') {pending=pending.filter(x=>x.batch!==item.batch);receipts=receipts.filter(x=>x.batch!==item.batch).concat(record).slice(-5);}
          else Object.assign(item,record);
        } catch {item.message='暂未取得最新结果，原件不会因此丢失。可查看私有处理记录，回到前台后自动重试。';}
      }
      save();render();
    } finally {refreshing=false;}
  }
  el('newUploadForm').addEventListener('submit',event=>{
    event.preventDefault();
    if (!ready) {el('newUploadNotice').textContent='自动入库尚未启用，请先完成一次性配置。';return;}
    try {
      const result=makeUploadRelease({cat:el('uploadCategory').value,tags:el('uploadTags').value,
        mode:el('uploadMode').value,title:el('uploadTitle').value,expectedCount:el('uploadExpected').value},categories);
      pending.push({batch:result.batch,cat:result.spec.cat,createdAt:new Date().toISOString()});save();render();
      el('newUploadNotice').textContent='已记住所选分类。在 GitHub 添加文件并点 Publish release，返回本页可查看结果；云端整理启动后可关闭手机。';
      el('resumeNewUpload').href=result.url;el('resumeNewUpload').hidden=false;
      const opened=window.open(result.url,'_blank','noopener,noreferrer');
      // The persistent link also works when an OEM browser blocks pop-ups.
      if (!opened) el('newUploadNotice').textContent+=' 若没有打开新页面，请点下方“打开本次上传”。';
    } catch(error) {el('newUploadNotice').textContent=error.message;}
  });
  el('refreshUploadStatus').addEventListener('click',refresh);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
  window.addEventListener('online',refresh);window.addEventListener('pageshow',refresh);
  setInterval(()=>{if(pending.length)refresh();},15000);
  async function load() {
    try {
      const [catalogue,automation]=await Promise.all([fetch('books.json',{cache:'no-store'}),fetch('upload-automation.json',{cache:'no-store'})]);
      if(!catalogue.ok||!automation.ok)throw new Error('上传设置暂时未载入，请刷新重试。');
      const data=await catalogue.json(),state=await automation.json();categories=data.categories;
      el('uploadCategory').replaceChildren(...categories.map(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.name;return o;}));
      el('uploadCategory').value=categories.some(c=>c.id===url.searchParams.get('cat'))?url.searchParams.get('cat'):'high-school-physics';
      ready=state.version===1&&state.ready===true;el('startNewUpload').disabled=!ready;
      el('automationSetup').hidden=ready;el('automationState').textContent=ready?'自动入库已启用。选择分类后上传，不需要回聊天处理。':'自动入库已准备好，尚需完成一次 GitHub 发布授权。启用前不会把资料误报成已入库。';
    }catch(error){el('automationState').textContent=error.message;}
  }
  render();load();refresh();
}
