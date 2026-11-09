import {decryptSnapshot, planFiles, createUploadZip} from './upload-checker-core.mjs';

const element = id => document.getElementById(id);
const picker = element('checkFiles'), status = element('checkStatus');
let snapshot, plan, abort, downloadURL;
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
  picker.disabled = value || !snapshot;
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
async function initialize() {
  picker.disabled = true;
  const id = new URLSearchParams(location.search).get('batch');
  const key = new URLSearchParams(location.hash.slice(1)).get('k');
  if (!/^[a-f0-9]{32}$/.test(id || '') || !key) {
    element('inventoryStatus').textContent = '请从聊天中打开这批资料的完整私人核对链接，成功记录会自动载入。无需登录、密码或插件。';
    return;
  }
  try {
    const response = await fetch(`upload-check-data/${id}.json`, {cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
    if (!response.ok) throw new Error('已上传记录未载入。请从聊天重新打开本次链接。');
    snapshot = await decryptSnapshot(await response.json(), key);
    element('inventoryStatus').textContent = `已载入 ${snapshot.uploaded.length} 份成功上传记录；本批目标 ${snapshot.expectedCount} 份。现在可以全选原文件。`;
    element('inventoryDate').textContent = `记录时间：${new Date(snapshot.checkedAt).toLocaleString('zh-CN')}。核对过程中不会上传文件。`;
    picker.disabled = false;
  } catch (error) {
    snapshot = null;
    picker.disabled = true;
    element('inventoryStatus').textContent = error.message || '记录无法解密，请从聊天重新打开完整链接。';
  }
}
picker.addEventListener('click', () => { if (!abort) picker.value = ''; });
picker.addEventListener('change', async () => {
  const files = Array.from(picker.files);
  if (!files.length || !snapshot || abort) return;
  releasePackage(); plan = null;
  element('packageSection').hidden = true;
  element('makePackage').hidden = true;
  element('checkResults').hidden = true;
  element('checkRows').replaceChildren();
  element('checkSummary').textContent = '';
  element('checkWork').hidden = false;
  element('checkProgress').value = 0;
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
});
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
initialize();
