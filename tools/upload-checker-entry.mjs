import {decryptSnapshot, planFiles, createUploadZip} from './upload-checker-core.mjs';

const element = id => document.getElementById(id);
const picker = element('checkFiles'), status = element('checkStatus');
let snapshot, plan, abort, downloadURL, loader, selectedFiles = [], loadVersion = 0;
const savedContextKey = "nicole-upload-check-context-v1";
const bytesLabel = size => size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const labels = {uploaded: '已上传，跳过', missing: '需要补传', duplicate: '本次内容重复，跳过', invalid: '未能核对'};
let lastProgress = 0;
function progress(value) {
  const now = performance.now();
  if (now - lastProgress < 150 && value.bytes !== value.totalBytes) return;
  lastProgress = now;
  element('checkProgress').value = value.totalBytes ? value.bytes / value.totalBytes * 100 : 0;
  status.textContent = `${value.phase === 'checking' ? '正在本地核对' : '正在生成补传包'} ${value.index + 1}/${value.total}：${value.name}`;
}
function busy(value) {
  picker.disabled = value;
  element('retryInventory').disabled = value;
  element('restoreInventory').disabled = value;
  element('makePackage').disabled = value;
  element('cancelCheck').hidden = !value;
}
function releasePackage() {
  if (downloadURL) URL.revokeObjectURL(downloadURL);
  downloadURL = null;
  element('downloadPackage').hidden = true;
  element('downloadPackage').removeAttribute('href');
  element('nextSteps').hidden = true;
  element('packageInfo').textContent = '';
}
function readRememberedContext() {
  try {
    const value = JSON.parse(localStorage.getItem(savedContextKey));
    if (/^[a-f0-9]{32}$/.test(value?.id) && /^[A-Za-z0-9_-]{43}$/.test(value?.key)) return value;
  } catch {}
  return null;
}
function readContext(url) {
  const id = new URLSearchParams(url.search).get('batch');
  const key = new URLSearchParams(url.hash.slice(1)).get('k');
  const remembered = readRememberedContext();
  const value = {id: id || (!key ? remembered?.id : null), key: key || ((!id || id === remembered?.id) ? remembered?.key : null)};
  return /^[a-f0-9]{32}$/.test(value.id || '') && /^[A-Za-z0-9_-]{43}$/.test(value.key || '') ? value : null;
}
async function initialize(restored) {
  const version = ++loadVersion;
  loader?.abort();
  snapshot = null; releasePackage(); plan = null;
  picker.disabled = !!abort;
  element('makePackage').hidden = true;
  element('packageSection').hidden = true;
  element('checkSummary').textContent = '';
  element('checkResults').hidden = true;
  if (selectedFiles.length) {
    element('checkWork').hidden = false;
    status.textContent = `已选择 ${selectedFiles.length} 份文件，正在等待核对记录。记录载入后自动核对；现在不会上传或打包。`;
  }
  element('inventoryDate').textContent = '';
  const context = restored || readContext(new URL(location.href));
  if (!context) {
    busy(!!abort);
    element('inventoryStatus').textContent = '核对记录还没载入。可以先选文件，再从聊天重新打开完整的私人链接，或在下方粘贴链接。记录载入后会自动核对。';
    element('recordRecovery').hidden = false;
    return;
  }
  busy(!!abort);
  element('inventoryStatus').textContent = '正在载入本次已上传记录…可以先选择文件。';
  const request = new AbortController();
  loader = request;
  const timeout = setTimeout(() => request.abort(), 20000);
  try {
    const response = await fetch(`upload-check-data/${context.id}.json`, {cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:request.signal});
    if (!response.ok) throw new Error('已上传记录未载入，请点“重新载入记录”。已选文件会保留。');
    const loaded = await decryptSnapshot(await response.json(), context.key);
    if (version !== loadVersion) return;
    snapshot = loaded;
    try { localStorage.setItem(savedContextKey, JSON.stringify(context)); } catch {}
    const url = new URL(location.href);
    url.searchParams.set('batch', context.id); url.hash = 'k=' + context.key;
    history.replaceState(null, '', url);
    element('inventoryStatus').textContent = `已载入 ${snapshot.uploaded.length} 份成功上传记录；本批目标 ${snapshot.expectedCount} 份。现在可以全选原文件。`;
    element('inventoryDate').textContent = `记录时间：${new Date(snapshot.checkedAt).toLocaleString('zh-CN')}。核对过程中不会上传文件。`;
    element('recordRecovery').hidden = true;
    element('privateCheckLink').value = '';
  } catch (error) {
    if (version !== loadVersion) return;
    snapshot = null;
    element('inventoryStatus').textContent = request.signal.aborted
      ? '记录加载超时。请点“重新载入记录”；已选文件会保留，不会自动打包。'
      : error.message || '记录无法解密，请在下方粘贴聊天中的完整链接后重试。';
    element('recordRecovery').hidden = false;
  } finally {
    clearTimeout(timeout);
    if (version === loadVersion) { busy(!!abort); }
  }
  if (version === loadVersion && snapshot) {
    if (!selectedFiles.length && picker.files.length) selectedFiles = Array.from(picker.files);
    if (selectedFiles.length) await checkSelectedFiles();
  }
}
picker.addEventListener('click', () => { if (!abort) picker.value = ''; });
picker.addEventListener('change', async () => {
  if (abort) return;
  selectedFiles = Array.from(picker.files);
  if (!selectedFiles.length) return;
  await checkSelectedFiles();
});
async function checkSelectedFiles() {
  if (abort || !selectedFiles.length) return;
  const files = selectedFiles;
  releasePackage(); plan = null;
  element('packageSection').hidden = true;
  element('makePackage').hidden = true;
  element('checkResults').hidden = true;
  element('checkRows').replaceChildren();
  element('checkSummary').textContent = '';
  element('checkWork').hidden = false;
  element('checkProgress').value = 0;
  if (!snapshot) {
    status.textContent = `已选择 ${files.length} 份文件，正在等待核对记录。记录载入后自动核对；现在不会上传或打包。`;
    return;
  }
  abort = new AbortController(); busy(true);
  try {
    plan = await planFiles(files, snapshot, {signal: abort.signal, progress});
    const counts = Object.fromEntries(Object.keys(labels).map(state => [state, plan.rows.filter(row => row.state === state).length]));
    element('checkSummary').textContent = `已选择 ${files.length} · 已上传 ${counts.uploaded} · 待补传 ${counts.missing} · 本次重复 ${counts.duplicate} · 未能核对 ${counts.invalid}`;
    for (const row of plan.rows) {
      const item = document.createElement('li');
      item.textContent = `${row.file.name}：${labels[row.state]}${row.reason ? '。' + row.reason : ''}`;
      element('checkRows').append(item);
    }
    element('checkResults').hidden = false;
    element('checkProgress').value = 100;
    if (counts.invalid) {
      status.textContent = '有文件未能核对，暂不生成补传包。请把这些文件完整保存到手机后重新选择。';
      element('checkResults').open = true;
    } else if (!counts.missing) {
      status.textContent = '所选文件的内容均已上传，或是本次重复选择；无需补传。';
    } else {
      status.textContent = `核对完成。只需打包 ${counts.missing} 份资料；原有成功附件保持不动。`;
      if (files.length !== snapshot.expectedCount) status.textContent += ` 本次选择 ${files.length} 份，目标为 ${snapshot.expectedCount} 份；若要一次查齐，请重新全选全部原文件。`;
      element('packageSection').hidden = false;
      element('makePackage').hidden = false;
      element('makePackage').textContent = `生成补传包（${counts.missing} 份）`;
    }
  } catch (error) {
    plan = null;
    status.textContent = abort.signal.aborted ? '已取消，没有上传或删除文件。可以重新选择这批资料。' : error.message;
  } finally { abort = null; busy(false); }
}
element('makePackage').addEventListener('click', async () => {
  if (!plan || abort) return;
  releasePackage(); abort = new AbortController(); busy(true);
  try {
    const result = await createUploadZip(plan, {signal: abort.signal, progress});
    downloadURL = URL.createObjectURL(result.blob);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)), byte => byte.toString(16).padStart(2,'0')).join('');
    const filename = `physics-missing-${result.count}-${stamp}-${suffix}.zip`;
    const link = element('downloadPackage');
    link.href = downloadURL; link.download = filename;
    link.textContent = `下载补传包（${result.count} 份，${bytesLabel(result.blob.size)}）`;
    link.hidden = false;
    element('packageName').textContent = filename;
    element('packageInfo').textContent = `包已在手机本地生成，还没有上传到 GitHub。下载后只需上传这个 ZIP。`;
    element('nextSteps').hidden = false;
    element('makePackage').hidden = true;
    element('checkProgress').value = 100;
    status.textContent = '补传包已生成。点击下载，再到 GitHub 上传这一个 ZIP。';
  } catch (error) {
    status.textContent = abort.signal.aborted ? '已取消打包，原文件没有改变。可以重新生成。' : '打包未完成：' + error.message;
  } finally { abort = null; busy(false); }
});
element('cancelCheck').addEventListener('click', () => { abort?.abort(); });
window.addEventListener('beforeunload', event => {
  if (abort) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('hashchange', () => {
  abort?.abort(); abort = null; snapshot = null;
  location.reload();
});
element('retryInventory').addEventListener('click', () => { if (!abort) initialize(); });
element('recordRecovery').addEventListener('submit', event => {
  event.preventDefault();
  if (abort) return;
  try {
    const url = new URL(element('privateCheckLink').value.trim());
    if (url.origin !== location.origin || url.pathname !== location.pathname) throw new Error('请复制这张核对页的完整私人链接。');
    const id = url.searchParams.get('batch'), key = new URLSearchParams(url.hash.slice(1)).get('k');
    if (!/^[a-f0-9]{32}$/.test(id || '') || !/^[A-Za-z0-9_-]{43}$/.test(key || '')) throw new Error('链接缺少核对信息，请在聊天中长按私人链接，复制完整链接后粘贴。');
    initialize({id,key});
  } catch (error) { element('inventoryStatus').textContent = error.message || '请粘贴完整的私人核对链接。'; }
});
window.nicoleUploadCheckerStarted = true;
initialize();
