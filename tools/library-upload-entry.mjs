import {makeUploadRelease,validateUploadStatus,batchPattern} from './library-upload.mjs';
import {initializeDirectUpload} from './direct-upload-entry.mjs';

export function initializeLibraryUpload() {
  const el=id=>document.getElementById(id);
  if (!el('newUploadForm')) return;
  const url=new URL(location.href);
  const legacyUpload=url.searchParams.get('legacyUpload')==='1';
  if(legacyUpload){el('directUploadControls').hidden=true;el('legacyUploadInstructions').hidden=false;el('startNewUpload').textContent='前往上传';}
  el('legacyChecker').open=url.searchParams.has('batch') || url.searchParams.has('legacy');
  let categories=[],subcategories=[],ready=false,refreshing=false,settingsLoading=false,categoriesLoaded=false;
  let direct;
  const checked=id=>Array.from(el(id).querySelectorAll('input:checked'),input=>input.value);
  function choices(id,items,selected){
    el(id).replaceChildren(...items.map(item=>{
      const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
      input.type='checkbox';input.name=id;input.value=item.id;input.checked=selected.includes(item.id);
      text.textContent=item.name;label.append(input,text);label.classList.toggle('is-selected',input.checked);return label;
    }));
  }
  function updateChoiceLabels(){
    for(const id of ['uploadCategories','uploadSubcategories'])el(id).querySelectorAll('label').forEach(label=>label.classList.toggle('is-selected',label.querySelector('input').checked));
    const selected=checked('uploadCategories');
    el('selectedCategoryCount').textContent=selected.length?`已选 ${selected.length} 类：${selected.map(id=>categories.find(c=>c.id===id)?.name).join('、')}。同一份资料会在这些类别中显示。`:'请至少勾选一个分类。';
  }
  function renderSubcategories(){
    const previous=checked('uploadSubcategories'),items=subcategories.filter(s=>checked('uploadCategories').includes(s.parent));
    el('uploadSubcategoryField').hidden=!items.length;
    choices('uploadSubcategories',items,previous);updateChoiceLabels();
  }
  el('uploadCategories').addEventListener('change',renderSubcategories);
  el('uploadSubcategories').addEventListener('change',updateChoiceLabels);
  const pendingKey='nicole-library-pending-v1',receiptsKey='nicole-library-receipts-v1';
  const waitingMessage='尚未收到云端处理记录。请先在 GitHub 完成附件上传并点 Publish release；此处刷新只查询结果，不会重新上传文件。';
  function read(key) {try {const rows=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(rows)?rows.filter(x=>batchPattern.test(x.batch)).slice(-20):[];}catch{return [];}}
  let pending=read(pendingKey),receipts=read(receiptsKey);
  function save(){try{localStorage.setItem(pendingKey,JSON.stringify(pending));localStorage.setItem(receiptsKey,JSON.stringify(receipts.slice(-5)));}catch{}}
  function row(item,done=false) {
    const li=document.createElement('li');
    if(!done){
      const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='remove-selection receipt-dismiss';dismiss.textContent='×';dismiss.setAttribute('aria-label','移除此条未完成记录');
      dismiss.addEventListener('click',()=>{pending=pending.filter(x=>x.batch!==item.batch);save();render();});li.append(dismiss);
    }
    const text=document.createElement('p');text.textContent=done?'上传成功，已入库。':item.message||waitingMessage;li.append(text);
    if(!done&&item.statusError){const error=document.createElement('p');error.className='muted';error.textContent=item.statusError;li.append(error);}
    const detail=document.createElement('p');detail.className='muted';detail.textContent=`批次 ${item.batch.replace('upload-','')}${item.sourceCount?` · ${item.sourceCount} 份资料`:''}`;li.append(detail);
    if(done){
      for(const cat of item.cats||[item.cat]){
        const link=document.createElement('a');link.href=`./?cat=${encodeURIComponent(cat)}`;
        link.textContent=`查看${categories.find(c=>c.id===cat)?.name||'所选分类'}`;link.className='receipt-category-link';li.append(link);
      }
    }else if(item.source!=='direct'){
      const link=document.createElement('a');link.rel='noreferrer';
      link.href=item.stage?'https://github.com/Nicole8206929/study-materials-originals/actions/workflows/auto-library.yml':'https://github.com/Nicole8206929/study-materials-originals/releases';
      link.textContent=item.stage?'查看私有处理记录':'回 GitHub 继续上传／发布';li.append(link);
    }
    return li;
  }
  function render() {
    el('pendingUploads').replaceChildren(...pending.map(x=>row(x)));
    el('completedUploads').replaceChildren(...receipts.slice(-5).reverse().map(x=>row(x,true)));
    el('uploadTracking').hidden=!pending.length&&!receipts.length;
    el('pendingHeading').textContent=pending.length?pending.every(item=>item.source==='direct')?`已上传，待入库 ${pending.length} 批`:`未完成 ${pending.length} 批`:'待处理列表已清空';
  }
  async function refresh() {
    if (refreshing || document.visibilityState==='hidden' || navigator.onLine===false) return;
    refreshing=true;
    let failed=0;
    try {
      for (const item of [...pending]) {
        try {
          let value;
          if(item.source==='direct'&&direct?.connected)value=await direct.status(item.batch);
          else{
          const response=await fetch(`upload-status/${item.batch}.json?fresh=${Date.now()}`,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout?AbortSignal.timeout(15000):undefined});
          if (response.status===404) {
            delete item.statusError;
            if(!item.stage)item.message=waitingMessage;
            continue;
          }
          if (!response.ok) throw new Error('记录暂时不可用，返回前台后会重试。');
          value=await response.json();
          }
          const record=validateUploadStatus(value,item.batch);
          delete item.statusError;
          if (record.stage==='ready') {pending=pending.filter(x=>x.batch!==item.batch);receipts=receipts.filter(x=>x.batch!==item.batch).concat(record).slice(-5);}
          else if(record.stage==='failed'){pending=pending.filter(x=>x.batch!==item.batch);failed++;}
          else Object.assign(item,record);
        } catch {item.statusError=item.source==='direct'?'暂时无法查询最新入库结果，请稍后刷新。已确认接收的文件不会重复传输。':'暂时无法查询最新处理结果，请稍后刷新。若 GitHub 添加附件失败，请回原上传页重试；刷新不会重传手机文件。';}
      }
      save();render();
      if(failed)el('newUploadNotice').textContent=`${failed} 批上传未完成，已从未完成列表移除。可重新选择文件再试。`;
    } finally {refreshing=false;}
  }
  const input=()=>({cats:checked('uploadCategories'),subcats:checked('uploadSubcategories'),tags:el('uploadTags').value,mode:el('uploadMode').value,title:el('uploadTitle').value,expectedCount:el('uploadExpected').value});
  el('newUploadForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(direct){await direct.start();return;}
    if(!legacyUpload){el('newUploadNotice').textContent='原页上传服务暂未连接，请刷新设置后重试。';return;}
    if (!ready) {el('newUploadNotice').textContent='自动入库尚未启用，请先完成一次性配置。';return;}
    try {
      const result=makeUploadRelease({cats:checked('uploadCategories'),subcats:checked('uploadSubcategories'),tags:el('uploadTags').value,
        mode:el('uploadMode').value,title:el('uploadTitle').value,expectedCount:el('uploadExpected').value},categories);
      pending.push({batch:result.batch,cat:result.spec.cat,cats:result.spec.cats,createdAt:new Date().toISOString()});save();render();
      el('newUploadNotice').textContent='已记住所选分类。在 GitHub 添加文件并点 Publish release，返回本页可查看结果；云端整理启动后可关闭手机。';
      el('resumeNewUpload').href=result.url;el('resumeNewUpload').hidden=false;
      const opened=window.open(result.url,'_blank','noopener,noreferrer');
      // The persistent link also works when an OEM browser blocks pop-ups.
      if (!opened) el('newUploadNotice').textContent+=' 若没有打开新页面，请点下方“打开本次上传”。';
    } catch(error) {el('newUploadNotice').textContent=error.message;}
  });
  function resume(){load();refresh();}
  el('refreshUploadStatus').addEventListener('click',resume);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resume();});
  window.addEventListener('online',resume);window.addEventListener('pageshow',resume);
  setInterval(()=>{if(pending.length)refresh();if(!ready&&document.visibilityState==='visible')load();},15000);
  async function load() {
    if(settingsLoading)return;
    settingsLoading=true;
    try {
      const [catalogue,automation]=await Promise.all([fetch('books.json',{cache:'no-store'}),fetch('upload-automation.json',{cache:'no-store'})]);
      if(!catalogue.ok||!automation.ok)throw new Error('上传设置暂时未载入，请刷新重试。');
      const data=await catalogue.json(),state=await automation.json(),previous=checked('uploadCategories');categories=data.categories;subcategories=data.subcategories||[];
      const initial=categories.some(c=>c.id===url.searchParams.get('cat'))?url.searchParams.get('cat'):'high-school-physics';
      choices('uploadCategories',categories,categoriesLoaded?previous:[initial]);categoriesLoaded=true;
      renderSubcategories();render();
      ready=state.version===1&&state.ready===true;el('startNewUpload').disabled=!ready||!legacyUpload;
      el('automationSetup').hidden=ready;el('automationState').textContent=ready?'自动入库已启用。选择分类后上传，不需要回聊天处理。':'自动入库已准备好，尚需完成一次 GitHub 发布授权。启用前不会把资料误报成已入库。';
      if(!legacyUpload){
        const response=await fetch('upload-service.json',{cache:'no-store'});
        if(!response.ok)throw new Error('原页上传设置暂未载入，请稍后刷新。');
        const config=await response.json();
        if(config.version!==1||typeof config.ready!=='boolean'||config.endpoint!=='https://nicole-private-book-upload.vibrantcloth2.chatgpt.site')throw new Error('原页上传设置不完整，请稍后刷新。');
        if(!direct)direct=initializeDirectUpload({config,authorizationUrl:url.href,categories:()=>categories,input,notify:message=>{el('newUploadNotice').textContent=message;},onQueued:record=>{
          pending=pending.filter(x=>x.batch!==record.batch).concat(record);save();render();refresh();
        }});
        direct.configure(config);if(!config.ready){ready=false;el('automationState').textContent='原网页上传服务已部署，正在等待接口连接授权。可以先选择文件；尚未开始传输。';}
      }
    }catch(error){if(!legacyUpload)ready=false;el('startNewUpload').disabled=true;el('automationState').textContent=error.message;}
    finally{settingsLoading=false;}
  }
  render();load();refresh();
}
