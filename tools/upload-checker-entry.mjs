import {decryptSnapshot, planFiles, createUploadZip} from './upload-checker-core.mjs';
import {FileSelection} from './file-selection.mjs';
import {screenActivity} from './screen-activity.mjs';
import {initializeLibraryUpload} from './library-upload-entry.mjs';

initializeLibraryUpload();

const element = id => document.getElementById(id);
const picker = element('checkFiles'), folderPicker = element('checkFolder'), status = element('checkStatus');
const selection = new FileSelection(), hashCache = new WeakMap();
let snapshot, plan, abort, downloadURL, loader, loadVersion = 0, revision = 0, checkAgain = false, pausedByUser = false;
const savedContextKey = 'nicole-upload-check-context-v1';
const bytesLabel = size => size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const labels = {uploaded:'已上传，跳过',missing:'需要补传',duplicate:'本次内容重复，跳过',invalid:'未能核对'};
function showInventory() {
  const archived = snapshot.stage === 'compiled';
  labels.uploaded = archived ? '已归入合集，跳过' : '已上传，跳过';
  element('inventoryStatus').textContent = `已载入 ${snapshot.uploaded.length} 份${archived ? '合订归档' : '成功上传'}记录；本批目标 ${snapshot.expectedCount} 份。` +
    (archived ? '本批已完成，原资料按约定清理，只保留最终合集。已收录的内容会跳过。' : '现在可以分批添加原文件。');
  element('inventoryDate').textContent = `记录时间：${new Date(snapshot.checkedAt).toLocaleString('zh-CN')}。核对过程中不会上传文件。`;
}
let lastProgress = 0;
const activity = screenActivity({
  request: navigator.wakeLock?.request ? () => navigator.wakeLock.request('screen') : null,
  visible: () => document.visibilityState === 'visible',
  notify: text => { element('backgroundStatus').textContent = text; }
});
function progress(value) {
  const now = performance.now();
  if (now - lastProgress < 150 && value.bytes !== value.totalBytes) return;
  lastProgress = now;
  element('checkProgress').value = value.totalBytes ? value.bytes / value.totalBytes * 100 : 0;
  status.textContent = `${value.phase === 'checking' ? '正在本地核对' : '正在生成补传包'} ${value.index + 1}/${value.total}：${value.name}`;
}
function busy(value) {
  activity.setActive(value);
  // Adding/removing files is allowed while a read runs: edits cancel the old
  // task, invalidate its result and schedule a check of the new selection.
  picker.disabled = false; folderPicker.disabled = false;
  element('retryInventory').disabled = value;
  element('restoreInventory').disabled = value;
  element('makePackage').disabled = value;
  element('recheckSelection').disabled = value || !snapshot || !selection.entries.length;
  element('cancelCheck').hidden = !value;
}
function releasePackage() {
  const existed = !!downloadURL;
  if (downloadURL) URL.revokeObjectURL(downloadURL);
  downloadURL = null;
  element('downloadPackage').hidden = true;
  element('downloadPackage').removeAttribute('href');
  element('nextSteps').hidden = true;
  element('packageInfo').textContent = '';
  return existed;
}
function invalidatePlan() {
  const hadPackage = releasePackage(); plan = null;
  element('makePackage').hidden = true;
  element('packageSection').hidden = true;
  element('checkSummary').textContent = '';
  element('checkResults').hidden = true;
  return hadPackage;
}
function renderSelection() {
  const rows = new Map((plan?.rows || []).map(row => [row.file,row]));
  element('selectionSection').hidden = !selection.entries.length && !selection.canUndo;
  element('selectionCount').textContent = `已选 ${selection.entries.length} 份文件（可继续添加）`;
  element('clearSelection').disabled = !selection.entries.length;
  element('undoSelection').hidden = !selection.canUndo;
  const list = element('selectedFiles'); list.replaceChildren();
  for (const entry of selection.entries) {
    const li = document.createElement('li'); li.className = 'selection-row';
    const name = entry.file.webkitRelativePath || entry.file.name;
    const copy = document.createElement('div');
    const title = document.createElement('span'); title.className = 'selection-name'; title.textContent = name;
    const detail = document.createElement('span'); detail.className = 'selection-meta';
    const row = rows.get(entry.file);
    detail.textContent = `${bytesLabel(entry.file.size)} · ${row ? labels[row.state] : '等待核对'}`;
    copy.append(title,detail);
    const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.remove = entry.id;
    remove.className = 'remove-selection'; remove.textContent = '×'; remove.setAttribute('aria-label',`移除 ${name}`);
    remove.title = '从本次选择中移除，不删除原件';
    li.append(copy,remove); list.append(li);
  }
  busy(!!abort);
}
function selectionChanged(message) {
  pausedByUser = false;
  revision++; checkAgain = true;
  const hadPackage = invalidatePlan();
  renderSelection();
  element('selectionNotice').textContent = message + (hadPackage ? ' 原补传包已失效，请重新生成；已经下载的旧包不会自动改变。' : '');
  if (abort) abort.abort();
  else checkSelectedFiles();
}
function addFiles(files, folder = false) {
  const received = Array.from(files);
  if (received.length) element('legacyChecker')?.setAttribute('open','');
  const accepted = folder ? received.filter(file => /\.(?:pdf|pptx?)$/i.test(file.name)) : received;
  if (!accepted.length) {
    if (received.length) element('selectionNotice').textContent = '这个文件夹中没有 PDF、PPT 或 PPTX，原有选择保留。';
    return;
  }
  try {
    const result = selection.add(accepted);
    const skipped = received.length - accepted.length;
    selectionChanged(`本次新增 ${result.added} 份，累计 ${result.total} 份。${result.reused ? `已更新 ${result.reused} 个重复选择项。` : ''}${skipped ? `文件夹中的 ${skipped} 个非课件文件未加入。` : ''}`);
  } catch (error) { element('selectionNotice').textContent = error.message; }
}
function readRememberedContext() {
  try {
    const value = JSON.parse(localStorage.getItem(savedContextKey));
    if (/^[a-f0-9]{32}$/.test(value?.id) && /^[A-Za-z0-9_-]{43}$/.test(value?.key)) return value;
  } catch {}
  return null;
}
function readContext(url) {
  const authorization=new URLSearchParams(url.hash.slice(1));
  if(['pair','github','githubSetup'].some(key=>authorization.has(key))||url.searchParams.get('connect')==='github')return null;
  const id = url.searchParams.get('batch'), key = new URLSearchParams(url.hash.slice(1)).get('k');
  const remembered = readRememberedContext();
  const value = {id:id || (!key ? remembered?.id : null), key:key || ((!id || id === remembered?.id) ? remembered?.key : null)};
  return /^[a-f0-9]{32}$/.test(value.id || '') && /^[A-Za-z0-9_-]{43}$/.test(value.key || '') ? value : null;
}
async function initialize(restored) {
  pausedByUser = false;
  const version = ++loadVersion;
  loader?.abort(); snapshot = null; revision++; invalidatePlan(); renderSelection();
  element('inventoryDate').textContent = '';
  if (selection.entries.length) {
    element('checkWork').hidden = false;
    status.textContent = `已选择 ${selection.entries.length} 份文件，正在等待核对记录。记录载入后自动核对；现在不会上传或打包。`;
  }
  const context = restored || readContext(new URL(location.href));
  if (!context) {
    element('inventoryStatus').textContent = '核对记录还没载入。可以先添加文件，再从聊天打开完整私人链接，或在下方粘贴链接。记录载入后自动核对。';
    element('recordRecovery').hidden = false;
    return;
  }
  element('inventoryStatus').textContent = '正在载入本次已上传记录…可以先分批添加文件。';
  const request = new AbortController(); loader = request;
  const timeout = setTimeout(() => request.abort(), 20000);
  try {
    const response = await fetch(`upload-check-data/${context.id}.json`, {cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:request.signal});
    if (!response.ok) throw new Error('已上传记录未载入，请点“重新载入记录”。已选文件会保留。');
    const loaded = await decryptSnapshot(await response.json(),context.key);
    if (version !== loadVersion) return;
    snapshot = loaded;
    try { localStorage.setItem(savedContextKey,JSON.stringify(context)); } catch {}
    const url = new URL(location.href); url.searchParams.set('batch',context.id); url.hash = 'k=' + context.key;
    history.replaceState(null,'',url);
    showInventory();
    element('recordRecovery').hidden = true; element('privateCheckLink').value = '';
  } catch (error) {
    if (version !== loadVersion) return;
    snapshot = null;
    element('inventoryStatus').textContent = request.signal.aborted
      ? '记录加载超时。请点“重新载入记录”；已选文件会保留，不会自动打包。'
      : error.message || '记录无法解密，请粘贴聊天中的完整链接后重试。';
    element('recordRecovery').hidden = false;
  } finally {
    clearTimeout(timeout);
    if (loader === request) loader = null;
    if (version === loadVersion) busy(!!abort);
  }
  if (version === loadVersion && snapshot) {
    if (!selection.entries.length && picker.files.length) addFiles(picker.files);
    else if (selection.entries.length) { checkAgain = true; checkSelectedFiles(); }
  }
}
picker.addEventListener('click',() => { picker.value = ''; });
picker.addEventListener('change',() => addFiles(picker.files));
folderPicker.addEventListener('click',() => { folderPicker.value = ''; });
folderPicker.addEventListener('change',() => addFiles(folderPicker.files,true));
element('folderPickerOption').hidden = !('webkitdirectory' in folderPicker);
element('selectedFiles').addEventListener('click',event => {
  const button = event.target.closest('button[data-remove]');
  if (!button) return;
  const entry = selection.entries.find(item => item.id === Number(button.dataset.remove));
  if (entry && selection.remove(entry.id)) selectionChanged(`已从本次选择中移除 ${entry.file.name}，手机和 GitHub 原件没有删除。`);
});
element('clearSelection').addEventListener('click',() => {
  selection.clear(); selectionChanged('已清空本次选择，手机和 GitHub 原件没有删除；可点“撤销移除”恢复。');
});
element('undoSelection').addEventListener('click',() => {
  const count = selection.undo(); selectionChanged(`已恢复 ${count} 份文件。`);
});
element('recheckSelection').addEventListener('click',() => { pausedByUser = false; checkAgain = true; checkSelectedFiles(); });
async function checkSelectedFiles() {
  if (abort) return;
  checkAgain = false;
  const files = selection.files, currentRevision = revision;
  invalidatePlan(); renderSelection();
  element('checkWork').hidden = false; element('checkProgress').value = 0;
  if (!files.length) { status.textContent = '本次没有选择文件，可以继续添加。原件没有上传或删除。'; return; }
  if (!snapshot) { status.textContent = `已选择 ${files.length} 份文件，正在等待核对记录。记录载入后自动核对；现在不会上传或打包。`; return; }
  const task = new AbortController(); abort = task; busy(true);
  try {
    const result = await planFiles(files,snapshot,{signal:task.signal,hashCache,progress:value => { if (currentRevision === revision) progress(value); }});
    if (task.signal.aborted || currentRevision !== revision) return;
    plan = result;
    const counts = Object.fromEntries(Object.keys(labels).map(state => [state,plan.rows.filter(row => row.state === state).length]));
    element('checkSummary').textContent = `已选择 ${files.length} · ${snapshot.stage === 'compiled' ? '已归档' : '已上传'} ${counts.uploaded} · 待补传 ${counts.missing} · 本次重复 ${counts.duplicate} · 未能核对 ${counts.invalid}`;
    element('checkRows').replaceChildren();
    for (const row of plan.rows) {
      const item = document.createElement('li'); item.textContent = `${row.file.name}：${labels[row.state]}${row.reason ? '。' + row.reason : ''}`;
      element('checkRows').append(item);
    }
    renderSelection(); element('checkResults').hidden = false; element('checkProgress').value = 100;
    if (counts.invalid) {
      status.textContent = '有文件未能核对。可在已选列表点“×”移除，或保存好原文件后重新添加。';
      element('checkResults').open = true;
    } else if (!counts.missing) status.textContent = `所选内容均已${snapshot.stage === 'compiled' ? '归入合集' : '上传'}或是重复项，无需补传。可以继续添加文件。`;
    else {
      status.textContent = `核对完成。只需打包 ${counts.missing} 份资料；原有成功附件保持不动。`;
      if (files.length !== snapshot.expectedCount) status.textContent += ` 本次累计 ${files.length} 份，目标 ${snapshot.expectedCount} 份；可以继续添加剩余文件。`;
      element('packageSection').hidden = false; element('makePackage').hidden = false;
      element('makePackage').textContent = `生成补传包（${counts.missing} 份）`;
    }
  } catch (error) {
    if (currentRevision === revision && !checkAgain) {
      plan = null;
      status.textContent = task.signal.aborted ? '已取消处理，已选列表保留。可移除、继续添加或重新核对。' : error.message;
    }
  } finally {
    if (abort === task) abort = null;
    busy(false);
    if (checkAgain) checkSelectedFiles();
  }
}
element('makePackage').addEventListener('click',async () => {
  if (!plan || abort) return;
  releasePackage();
  const currentRevision = revision, task = new AbortController(); abort = task; busy(true);
  try {
    const result = await createUploadZip(plan,{signal:task.signal,progress:value => { if (currentRevision === revision) progress(value); }});
    if (task.signal.aborted || currentRevision !== revision) return;
    downloadURL = URL.createObjectURL(result.blob);
    const stamp = new Date().toISOString().replace(/[-:]/g,'').slice(0,15);
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)),byte => byte.toString(16).padStart(2,'0')).join('');
    const filename = `physics-missing-${result.count}-${stamp}-${suffix}.zip`;
    const link = element('downloadPackage'); link.href = downloadURL; link.download = filename;
    link.textContent = `下载补传包（${result.count} 份，${bytesLabel(result.blob.size)}）`; link.hidden = false;
    element('packageName').textContent = filename;
    element('packageInfo').textContent = '包已在手机本地生成，还没有上传到 GitHub。下载后只需上传这个 ZIP。';
    element('nextSteps').hidden = false; element('makePackage').hidden = true; element('checkProgress').value = 100;
    status.textContent = '补传包已生成。点击下载，再到 GitHub 上传这一个 ZIP。';
  } catch (error) {
    if (currentRevision === revision && !checkAgain) status.textContent = task.signal.aborted ? '已取消打包，已选列表保留。' : '打包未完成：' + error.message;
  } finally {
    if (abort === task) abort = null;
    busy(false);
    if (checkAgain) checkSelectedFiles();
  }
});
element('cancelCheck').addEventListener('click',() => { pausedByUser = true; checkAgain = false; abort?.abort(); });
window.addEventListener('beforeunload',event => {
  if (abort) { event.preventDefault(); event.returnValue = ''; }
});
let returnedAt = 0, refreshingInventory = false;
async function resumePage() {
  activity.update();
  if (document.visibilityState !== 'visible') return;
  if (!pausedByUser && !abort && plan?.rows.some(row => row.state === 'invalid' && row.reason?.includes('无法读取'))) checkAgain = true;
  if (checkAgain && !abort) checkSelectedFiles();
  // Keep file references, completed hashes and an existing package. Refresh
  // the encrypted record without reloading this page or resetting selections.
  if (loader) { initialize(); return; }
  if (refreshingInventory || Date.now() - returnedAt < 15000) return;
  const context = readContext(new URL(location.href));
  if (!context) return;
  returnedAt = Date.now(); refreshingInventory = true;
  const currentVersion = loadVersion, request = new AbortController();
  const timer = setTimeout(() => request.abort(),20000);
  try {
    const response = await fetch(`upload-check-data/${context.id}.json`, {cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:request.signal});
    if (!response.ok) throw new Error('record');
    const loaded = await decryptSnapshot(await response.json(),context.key);
    if (currentVersion !== loadVersion) return;
    const signature = value => JSON.stringify([value?.expectedCount,value?.stage,value?.uploaded.map(item => `${item.size}:${item.sha256}`).sort()]);
    const changed = signature(snapshot) !== signature(loaded);
    snapshot = loaded;
    try { localStorage.setItem(savedContextKey,JSON.stringify(context)); } catch {}
    showInventory();
    element('recordRecovery').hidden = true;
    if (changed && selection.entries.length && pausedByUser) {
      revision++; checkAgain = false; invalidatePlan(); renderSelection();
      status.textContent = '已取消的处理保持停止。核对记录已更新，已选文件保留；点“重新核对已选文件”继续。';
    } else if (changed && selection.entries.length) selectionChanged('返回前台后已载入更新的记录，正在重新核对已选文件。');
    else element('resumeStatus').textContent = '已返回前台，核对记录未变；当前选择与处理进度保留。';
  } catch {
    if (currentVersion === loadVersion) element('resumeStatus').textContent = '返回前台后暂未刷新到核对记录，已选文件保留；联网后会重试。';
  } finally { clearTimeout(timer); refreshingInventory = false; }
}
document.addEventListener('visibilitychange',resumePage);
window.addEventListener('pageshow',event => { if (event.persisted) resumePage(); });
window.addEventListener('online',() => { returnedAt = 0; resumePage(); });
window.addEventListener('hashchange',() => { abort?.abort(); abort = null; snapshot = null; location.reload(); });
element('retryInventory').addEventListener('click',() => { if (!abort) initialize(); });
element('recordRecovery').addEventListener('submit',event => {
  event.preventDefault(); if (abort) return;
  try {
    const url = new URL(element('privateCheckLink').value.trim());
    if (url.origin !== location.origin || url.pathname !== location.pathname) throw new Error('请复制这张核对页的完整私人链接。');
    const id = url.searchParams.get('batch'), key = new URLSearchParams(url.hash.slice(1)).get('k');
    if (!/^[a-f0-9]{32}$/.test(id || '') || !/^[A-Za-z0-9_-]{43}$/.test(key || '')) throw new Error('链接缺少核对信息，请在聊天中长按私人链接，复制完整链接后粘贴。');
    initialize({id,key});
  } catch (error) { element('inventoryStatus').textContent = error.message || '请粘贴完整的私人核对链接。'; }
});
window.nicoleUploadCheckerStarted = true;
const earlyFiles = window.nicoleUploadEarlyFiles;
delete window.nicoleUploadEarlyFiles;
if (earlyFiles?.length) addFiles(earlyFiles);
initialize();
