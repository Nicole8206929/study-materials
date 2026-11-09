// ==UserScript==
// @name         Nicole 私有书架自动补传
// @namespace    https://nicole8206929.github.io/study-materials/
// @version      1.0.0
// @description  重新全选文件，核对成功附件后逐个补传；不覆盖成功文件。
// @match        https://github.com/Nicole8206929/study-materials-originals/releases*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      github.com
// @connect      release-assets.githubusercontent.com
// @connect      objects.githubusercontent.com
// @downloadURL  https://nicole8206929.github.io/study-materials/tools/github-upload-helper.user.js
// @updateURL    https://nicole8206929.github.io/study-materials/tools/github-upload-helper.user.js
// ==/UserScript==

(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.install();
})(function () {
  'use strict';
  const VERSION = '1.0.0';
  const REPO = '/Nicole8206929/study-materials-originals';
  const RELEASE_ID = '438226489';
  const MAX_BYTES = 2 * 1024 ** 3;
  const normalize = name => name.normalize('NFC');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  class StopError extends Error {}
  class UploadError extends Error {}
  class FileConflict extends Error {}

  class UploadQueue {
    constructor(adapter, changed = () => {}, wait = sleep) {
      this.adapter = adapter; this.changed = changed; this.wait = wait;
      this.jobs = []; this.running = false; this.paused = false; this.message = '选择文件后自动核对并补传。';
    }
    summary() {
      const counts = {total: this.jobs.length, skipped: 0, success: 0, failed: 0, conflict: 0, uploading: 0, pending: 0};
      for (const job of this.jobs) {
        if (job.state in counts) counts[job.state]++;
        else counts.pending++;
      }
      return {...counts, running: this.running, paused: this.paused, message: this.message};
    }
    notify() { this.changed(this.summary()); }
    add(files) {
      for (const file of files) {
        if (!file || typeof file.name !== 'string' || !Number.isSafeInteger(file.size)) throw new StopError('没有取得可靠的手机文件信息，已停止。');
        const existing = this.jobs.find(job => normalize(job.file.name) === normalize(file.name) && job.file.size === file.size);
        if (existing) {
          if (existing.state === 'failed') { existing.state = 'pending'; existing.attempts = 0; existing.reason = ''; }
          continue;
        }
        const conflict = this.jobs.find(job => normalize(job.file.name) === normalize(file.name) && job.file.size !== file.size);
        const job = {file, state: conflict ? 'conflict' : 'pending', attempts: 0, reason: conflict ? '选中了同名但大小不同的文件；请先改成不同名称。' : ''};
        if (conflict && conflict.state === 'pending') { conflict.state = 'conflict'; conflict.reason = job.reason; }
        this.jobs.push(job);
      }
      this.notify();
    }
    retry() {
      for (const job of this.jobs) if (job.state === 'failed') { job.state = 'pending'; job.attempts = 0; }
      this.paused = false;
      return this.run();
    }
    async run() {
      if (this.running) return;
      this.running = true; this.notify();
      try {
        await this.adapter.refresh();
        for (let index = 0; index < this.jobs.length && !this.paused; index++) {
          const job = this.jobs[index];
          if (job.state !== 'pending') continue;
          if (!job.file.size || job.file.size >= MAX_BYTES) { job.state = 'failed'; job.reason = '文件必须非空且小于 2 GiB。'; continue; }
          for (;;) {
            job.state = 'checking'; this.message = `正在核对：${job.file.name}`; this.notify();
            try {
              const remote = await this.adapter.inspect(job.file);
              if (remote) {
                if (remote.size !== job.file.size) throw new FileConflict('GitHub 中已有同名但大小不同的文件；不会覆盖。');
                job.state = 'skipped'; job.reason = '已上传，已跳过。'; break;
              }
              job.attempts++; job.state = 'uploading';
              this.message = `${this.adapter.verified ? '正在补传' : '首次小批验证'}：${job.file.name}`; this.notify();
              await this.adapter.upload(job.file);
              await this.adapter.verify(job.file);
              job.state = 'success'; job.reason = 'GitHub 已确认成功。'; break;
            } catch (error) {
              if (error instanceof StopError) {
                job.state = 'pending'; this.paused = true; this.message = error.message; break;
              }
              if (error instanceof FileConflict) { job.state = 'conflict'; job.reason = error.message; break; }
              if (!(error instanceof UploadError)) {
                job.state = 'pending'; this.paused = true; this.message = '无法可靠确认上传状态，已暂停；不会覆盖或删除现有附件。'; break;
              }
              if (job.attempts > 3) { job.state = 'failed'; job.reason = '重试三次后仍失败，点击“重试失败项”可继续。'; break; }
              this.message = `上传失败，准备第 ${job.attempts} 次重试：${job.file.name}`; this.notify();
              await this.wait([1500, 4000, 10000][job.attempts - 1] || 1500);
              if (this.paused) { job.state = 'pending'; break; }
              try { await this.adapter.cleanupFailed(job.file); await this.adapter.refresh(); }
              catch (error) { job.state = 'pending'; this.paused = true; this.message = error.message; break; }
            }
          }
          this.notify();
        }
        if (!this.paused) {
          const state = this.summary();
          if (!state.failed && !state.conflict && !state.pending && !state.uploading) {
            if (state.success) this.message = await this.adapter.saveDraft();
            else this.message = '所选文件都已上传，无须重复上传。';
          } else this.message = '已处理可补传的文件；失败项可直接重试，同名冲突不会覆盖。';
        }
      } catch (error) { this.paused = true; this.message = error instanceof StopError ? error.message : '读取 GitHub 页面失败，已暂停；请确认登录和网络。'; }
      finally { this.running = false; this.notify(); }
    }
  }

  function allowedPage(url) {
    return url.protocol === 'https:' && url.hostname === 'github.com' &&
      (url.pathname === `${REPO}/releases` || url.pathname.startsWith(`${REPO}/releases/`));
  }
  function pageURL(value) {
    const url = new URL(value, 'https://github.com');
    if (!allowedPage(url)) throw new StopError('上传助手只处理指定私有资料库，已停止。');
    url.hash = ''; return url;
  }
  function parseIndex(html, base, Parser) {
    const doc = new Parser().parseFromString(html, 'text/html');
    const files = new Map(); const fragments = new Set();
    for (const link of doc.querySelectorAll('a[href]')) {
      const url = new URL(link.getAttribute('href'), base);
      if (url.origin !== 'https://github.com' || !url.pathname.startsWith(`${REPO}/releases/download/`)) continue;
      let name;
      try { name = decodeURIComponent(url.pathname.split('/').pop()); } catch { throw new StopError('附件名称无法可靠识别，已停止。'); }
      const key = normalize(name);
      if (files.has(key) && files.get(key).url !== url.href) throw new StopError('附件出现同名歧义，已停止。');
      files.set(key, {name, url: url.href});
    }
    for (const item of doc.querySelectorAll('include-fragment[src],.js-release-expandable[data-expand-url]')) {
      const value = item.getAttribute('src') || item.getAttribute('data-expand-url');
      const url = new URL(value, base);
      if (url.origin === 'https://github.com' && url.pathname.startsWith(`${REPO}/releases/expanded_assets/`)) fragments.add(url.href);
    }
    return {files, fragments};
  }

  class GitHubAdapter {
    constructor(doc, win, request, changed = () => {}) {
      this.doc = doc; this.win = win; this.request = request; this.changed = changed;
      this.uploader = doc.querySelector('file-attachment.js-upload-release-file');
      this.form = doc.querySelector('form.js-release-form');
      this.files = new Map(); this.heads = new Map(); this.failures = new Map(); this.allowed = null;
      this.verified = false; this.confirmed = 0;
      this.originalFields = this.fields();
      if (!this.form || !this.uploader || doc.querySelector('#release_id')?.value !== RELEASE_ID) throw new StopError('未识别到指定上传区；请打开“书籍上传区”的编辑页。');
      const native = this.uploader.wrappedJSObject || this.uploader;
      if (typeof native.attach !== 'function') throw new StopError('GitHub 文件控件已变化，暂不自动上传；请复制诊断信息。');
    }
    fields() { return ['#release_name', '#release_body'].map(selector => this.doc.querySelector(selector)?.value || ''); }
    async read(url, method = 'GET') {
      const safe = pageURL(url);
      let response;
      try { response = await this.request({method, url: safe.href, timeout: 45000, headers: {Accept: method === 'GET' ? 'text/html' : '*/*'}}); }
      catch { throw new StopError('网络未能确认附件状态，已暂停；网络恢复后点“继续”。'); }
      if (response.status === 401 || response.status === 403 || /\/login(?:\?|$)/.test(response.finalUrl || '')) throw new StopError('请先在 Firefox 登录本人的 GitHub，再刷新上传区。');
      return response;
    }
    async refresh() {
      this.heads.clear();
      const edit = pageURL(this.win.location.href);
      if (!edit.pathname.includes('/releases/edit/')) throw new StopError('请回到上传区编辑页。');
      const view = new URL(edit.href); view.pathname = view.pathname.replace('/releases/edit/', '/releases/tag/'); view.search = `?helper=${Date.now()}`;
      const response = await this.read(view.href);
      if (response.status !== 200 || !response.responseText) throw new StopError('无法读取当前私有草稿，已暂停；原附件不会被改动。');
      const parsed = parseIndex(response.responseText, view.href, this.win.DOMParser);
      this.files = parsed.files;
      if (parsed.fragments.size > 5) throw new StopError('GitHub 附件列表结构异常，已暂停。');
      for (const url of parsed.fragments) {
        const fragment = await this.read(url + (url.includes('?') ? '&' : '?') + `helper=${Date.now()}`);
        if (fragment.status !== 200) throw new StopError('附件列表未完整展开，已暂停，避免重复上传。');
        for (const [key, item] of parseIndex(fragment.responseText, url, this.win.DOMParser).files) this.files.set(key, item);
      }
      const visible = [...this.doc.querySelectorAll('input[type=text]')].filter(input => /\.(?:pdf|epub|pptx?|ppsx?|odp)$/i.test(input.value));
      if (!this.files.size && visible.length) throw new StopError('页面已有附件，但助手尚未识别成功；已停止，避免重复上传。');
      this.changed(this.diagnostics());
    }
    async inspect(file) {
      if (this.failures.has(normalize(file.name))) { await this.cleanupFailed(file); await this.refresh(); }
      const key = normalize(file.name); const item = this.files.get(key);
      if (!item) return null;
      if (this.heads.has(key)) return this.heads.get(key);
      const response = await this.read(item.url, 'HEAD');
      if (response.status !== 200) throw new StopError(`无法确认同名附件是否完整：${file.name}。已暂停，不会删除它。`);
      const final = new URL(response.finalUrl || item.url);
      if (!['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(final.hostname)) throw new StopError('附件下载目标异常，已停止。');
      const values = [...String(response.responseHeaders || '').matchAll(/^content-length:\s*(\d+)\s*$/gim)];
      const size = values.length ? Number(values[values.length - 1][1]) : NaN;
      if (!Number.isSafeInteger(size) || size < 1) throw new StopError(`未取得同名附件的准确大小：${file.name}。已暂停。`);
      const existing = {...item, size}; this.heads.set(key, existing); return existing;
    }
    async upload(file) {
      const native = this.uploader.wrappedJSObject || this.uploader;
      if (!this.uploader.isConnected || typeof native.attach !== 'function') throw new StopError('GitHub 页面已刷新，请重新全选文件继续。');
      const initialInputs = new Set(this.doc.querySelectorAll('input'));
      await new Promise((resolve, reject) => {
        let ended = false;
        const finish = (error, attachment) => {
          if (ended) return; ended = true; clearTimeout(timer);
          for (const type of ['upload:complete', 'upload:error', 'upload:invalid']) this.doc.removeEventListener(type, terminal, true);
          this.allowed = null;
          if (error instanceof UploadError) this.failures.set(normalize(file.name), {file, initialInputs, attachment});
          error ? reject(error) : resolve();
        };
        const terminal = event => {
          if (event.target !== this.uploader) return;
          const raw = event.wrappedJSObject || event;
          let attachment;
          try { attachment = raw.detail.attachment; } catch { return finish(new StopError('浏览器未能读取原生上传事件，已暂停。')); }
          if (attachment?.file?.name !== file.name || attachment.file.size !== file.size) return;
          if (event.type === 'upload:complete') finish(null, attachment);
          else if (event.type === 'upload:invalid') finish(new FileConflict('GitHub 不接受此文件，未删除任何已上传附件。'), attachment);
          else finish(new UploadError('GitHub 报告上传失败。'), attachment);
        };
        for (const type of ['upload:complete', 'upload:error', 'upload:invalid']) this.doc.addEventListener(type, terminal, true);
        const timer = setTimeout(() => finish(new StopError('长时间未收到完成通知，已暂停；当前文件可能仍在上传，不会自动删除或重传。')), 10 * 60 * 1000);
        this.allowed = {file};
        try {
          // Build the array in the page realm. Firefox otherwise denies access
          // to extension-created event detail; native attach creates fresh
          // Attachment objects for every retry and owns all upload credentials.
          const files = new this.win.Array(); files.push(file.wrappedJSObject || file);
          Promise.resolve(native.attach(files)).catch(() => finish(new StopError('原生文件选择接口不兼容，已暂停。')));
        } catch { finish(new StopError('浏览器无法连接原生上传控件，已暂停。')); }
      });
    }
    async verify(file) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await sleep(1200 * attempt);
        await this.refresh();
        const existing = await this.inspect(file);
        if (existing && existing.size === file.size) {
          this.failures.delete(normalize(file.name)); this.confirmed++;
          if (this.confirmed >= 2) this.verified = true;
          return;
        }
      }
      throw new StopError('上传控件报告成功，但服务端尚未核实；已暂停，避免重复上传。');
    }
    async cleanupFailed(file) {
      const owned = this.failures.get(normalize(file.name));
      if (!owned) throw new StopError('无法确认失败占位项属于本次上传，已暂停，不会删除现有附件。');
      // An upload can finish on the server even if the response is lost. Never
      // click a removal control until a fresh download check proves that the
      // same-name attachment is unavailable, rather than merely trusting red UI.
      await this.refresh();
      const existing = this.files.get(normalize(file.name));
      const slug = pageURL(this.win.location.href).pathname.split('/').pop();
      const download = existing?.url || `https://github.com${REPO}/releases/download/${encodeURIComponent(slug)}/${encodeURIComponent(file.name)}`;
      const probe = await this.read(download, 'HEAD');
      if (probe.status === 200) throw new StopError('同名附件已完整存在，已暂停且不会删除它。重新打开上传区并全选即可核对后继续。');
      if (probe.status !== 404) throw new StopError('无法确认失败附件是否仍在服务端处理，已暂停，不会删除。');
      const candidates = [...this.doc.querySelectorAll('input[type=text]')].filter(input => input.value === file.name && !owned.initialInputs.has(input));
      let row, button;
      for (const input of candidates) {
        for (let parent = input.parentElement, depth = 0; parent && depth < 7; parent = parent.parentElement, depth++) {
          const fields = parent.querySelectorAll('input[type=text]');
          if (fields.length > 1) break;
          const failed = parent.matches('.is-failed,[data-state="failed"]') || /Upload failed|上传失败/i.test(parent.textContent);
          if (!failed || parent.matches('.is-uploading,[data-state="uploading"]')) continue;
          const buttons = [...parent.querySelectorAll('button')].filter(item =>
            /remove|delete|移除|删除/i.test([item.getAttribute('aria-label'), item.title, item.getAttribute('data-action')].filter(Boolean).join(' ')) || /^[×✕✖]$/.test(item.textContent.trim()));
          if (buttons.length === 1 && !buttons[0].disabled) { row = parent; button = buttons[0]; break; }
        }
        if (button) break;
      }
      if (!button) throw new StopError('未能安全识别本次失败项的移除按钮，已暂停；请复制诊断信息，不会删除成功附件。');
      button.click();
      for (let tries = 0; tries < 40; tries++) {
        if (!row.isConnected || row.hidden || row.querySelector('input[name$="[_destroy]"]')?.value === '1') {
          this.failures.delete(normalize(file.name)); return;
        }
        await sleep(100);
      }
      throw new StopError('失败占位项未完成移除，已暂停，避免同名冲突。');
    }
    async saveDraft() {
      if (JSON.stringify(this.fields()) !== JSON.stringify(this.originalFields)) return '文件已完成；标题或正文被手动改过，请检查后自行保存草稿。';
      const buttons = [...this.form.querySelectorAll('button')].filter(button => /^Save draft$|^保存草稿$/i.test(button.textContent.trim()));
      if (buttons.length !== 1 || buttons[0].disabled) return '文件已确认上传；请点 GitHub 的 Save draft 保存草稿，不要发布。';
      const saved = await new Promise(resolve => {
        const finish = value => { clearTimeout(timer); this.doc.removeEventListener('release:saved', handler, true); resolve(value); };
        const handler = event => {
          try { if (String((event.wrappedJSObject || event).detail.release.id) === RELEASE_ID) finish(true); } catch {}
        };
        const timer = setTimeout(() => finish(false), 8000);
        this.doc.addEventListener('release:saved', handler, true);
        buttons[0].click();
      });
      return saved ? '文件已确认上传，GitHub 已保存草稿；未点击发布。' : '文件已确认上传，已提交“保存草稿”；请核对 GitHub 的保存结果。';
    }
    diagnostics() {
      return {version: VERSION, releaseId: this.doc.querySelector('#release_id')?.value || '', uploader: !!this.uploader,
        attach: typeof (this.uploader?.wrappedJSObject || this.uploader)?.attach === 'function',
        existingLinks: this.files.size, ownedFailures: this.failures.size, nativeCompletions: this.confirmed,
        textFields: this.doc.querySelectorAll('input[type=text]').length,
        failedMarkers: this.doc.querySelectorAll('.is-failed,[data-state="failed"]').length};
    }
  }

  function install() {
    if (typeof window === 'undefined' || !allowedPage(new URL(location.href))) return;
    const nativeWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    let controller = null;
    function gmRequest(options) {
      if (typeof GM_xmlhttpRequest !== 'function') return Promise.reject(new StopError('没有取得扩展网络权限；请通过 Tampermonkey 安装，不能直接当网页脚本打开。'));
      return new Promise((resolve, reject) => GM_xmlhttpRequest({...options, onload: resolve, onerror: reject, ontimeout: reject}));
    }
    async function mount() {
      if (!allowedPage(new URL(location.href)) || document.getElementById('nicole-upload-helper')) return;
      if (!location.pathname.includes('/releases/edit/')) {
        if (location.pathname.replace(/\/$/, '') === `${REPO}/releases`) {
          const links = [...document.querySelectorAll(`a[href^="${REPO}/releases/edit/"]`)];
          const matching = links.filter(link => /书籍上传区/.test(link.closest('section,article,.Box,.release')?.textContent || ''));
          const link = matching.length === 1 ? matching[0] : links.length === 1 ? links[0] : null;
          if (link) location.replace(pageURL(link.href).href);
        }
        return;
      }
      const panel = document.createElement('section'); panel.id = 'nicole-upload-helper'; panel.setAttribute('aria-label', 'Nicole 自动补传助手');
      const title = document.createElement('h2'); title.textContent = '自动补传助手';
      const note = document.createElement('p'); note.textContent = '重新全选即可；按文件名和准确大小跳过成功附件，不覆盖。首次先逐个验证。';
      const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      const counts = document.createElement('p');
      const controls = document.createElement('div');
      if (typeof GM_getValue === 'function') {
        const last = GM_getValue('last-summary', null);
        if (last && Number.isSafeInteger(last.success)) note.textContent += ` 上次此浏览器记录成功 ${last.success} 个；本次仍以服务端核对为准。`;
      }
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试失败项'; retry.disabled = true;
      const pause = document.createElement('button'); pause.type = 'button'; pause.textContent = '暂停'; pause.disabled = true;
      const diagnose = document.createElement('button'); diagnose.type = 'button'; diagnose.textContent = '复制诊断信息';
      controls.append(retry, pause, diagnose); panel.append(title, note, status, counts, controls);
      const uploader = document.querySelector('file-attachment.js-upload-release-file');
      (uploader?.parentElement || document.querySelector('main') || document.body).prepend(panel);
      const css = '#nicole-upload-helper{padding:16px;margin:16px 0;border:1px solid var(--borderColor-default,#777);border-radius:6px;font:14px/1.6 system-ui;overflow-wrap:anywhere}#nicole-upload-helper h2{font-size:18px;margin:0 0 8px}#nicole-upload-helper p{margin:8px 0}#nicole-upload-helper>div{display:flex;gap:8px;flex-wrap:wrap}#nicole-upload-helper button{min-height:44px;padding:8px 12px;border:1px solid var(--borderColor-default,#777);border-radius:5px;color:inherit;background:var(--bgColor-muted,#eee);cursor:pointer}';
      if (typeof GM_addStyle === 'function') GM_addStyle(css);
      else { const style = document.createElement('style'); style.textContent = css; document.head.append(style); }
      let adapter, queue;
      const changed = state => {
        status.textContent = state.message;
        counts.textContent = `已跳过 ${state.skipped} · 已成功 ${state.success} · 正在上传 ${state.uploading} · 待处理 ${state.pending} · 失败 ${state.failed} · 冲突 ${state.conflict}`;
        retry.disabled = state.running || !state.failed;
        pause.disabled = !state.running && !state.paused;
        pause.textContent = state.paused ? '继续' : '暂停';
        if (!state.running && typeof GM_setValue === 'function') GM_setValue('last-summary', {...state, message: '', checkedAt: new Date().toISOString()});
      };
      const earlyFiles = []; let initializing = true; let initializationError = '';
      const loadingCapture = event => {
        if (event.target !== uploader) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (!initializing) { status.textContent = initializationError || '上传助手未能连接，已阻止整批上传；请复制诊断信息。'; return; }
        try {
          earlyFiles.push(...Array.from((event.wrappedJSObject || event).detail.attachments, item => item.file));
          status.textContent = '已保留本次选择，正在等待 GitHub 原生控件就绪…';
        } catch { status.textContent = '未能读取文件选择，请在控件就绪后重新选择。'; }
      };
      if (uploader && document.querySelector('#release_id')?.value === RELEASE_ID) {
        document.addEventListener('file-attachment-accept', loadingCapture, true);
        controller = {queue: null, capture: loadingCapture};
      }
      try {
        if (uploader && typeof (uploader.wrappedJSObject || uploader).attach !== 'function') {
          status.textContent = '正在等待 GitHub 原生文件控件…';
          // A registry promise can resolve before the existing DOM element's
          // upgrade reactions finish. Wait for the actual instance interface.
          const deadline = Date.now() + 10000;
          while (typeof (uploader.wrappedJSObject || uploader).attach !== 'function' && Date.now() < deadline) {
            await sleep(50);
            if (!panel.isConnected) return;
          }
        }
        adapter = new GitHubAdapter(document, nativeWindow, gmRequest);
        queue = new UploadQueue(adapter, changed); queue.notify();
        status.textContent = '已连接原生文件控件。请先重新选择文件；将核对后逐个补传。真实上传尚未验证。';
      } catch (error) { initializing = false; earlyFiles.length = 0; initializationError = error.message; status.textContent = error.message; }
      diagnose.addEventListener('click', async () => {
        const data = adapter ? adapter.diagnostics() : {version: VERSION, releaseId: document.querySelector('#release_id')?.value || '', uploader: !!uploader};
        const text = JSON.stringify(data);
        try { await navigator.clipboard.writeText(text); status.textContent = '诊断信息已复制，不包含文件正文、密码或令牌。'; }
        catch { status.textContent = `请复制这段诊断信息：${text}`; }
      });
      if (!queue) return;
      retry.addEventListener('click', () => queue.retry());
      pause.addEventListener('click', () => {
        queue.paused = !queue.paused;
        if (queue.paused) { queue.message = '当前文件完成后暂停。'; queue.notify(); }
        else queue.run();
      });
      const capture = event => {
        if (event.target !== adapter.uploader) return;
        let attachments;
        try { attachments = (event.wrappedJSObject || event).detail.attachments; }
        catch { event.preventDefault(); event.stopImmediatePropagation(); status.textContent = '浏览器未能读取文件选择事件，已阻止批量上传；请复制诊断信息。'; return; }
        if (adapter.allowed && attachments.length === 1 &&
            attachments[0].file.name === adapter.allowed.file.name &&
            attachments[0].file.size === adapter.allowed.file.size &&
            attachments[0].file.lastModified === adapter.allowed.file.lastModified) { adapter.allowed = null; return; }
        event.preventDefault(); event.stopImmediatePropagation();
        try { queue.add(Array.from(attachments, item => item.file)); queue.paused = false; queue.run(); }
        catch (error) { status.textContent = error.message; }
      };
      document.addEventListener('file-attachment-accept', capture, true);
      document.removeEventListener('file-attachment-accept', loadingCapture, true);
      initializing = false;
      controller = {queue, adapter, capture};
      if (earlyFiles.length) { queue.add(earlyFiles); queue.run(); }
      else adapter.refresh().then(() => {
          if (!queue.running && !queue.jobs.length) status.textContent = `已识别 ${adapter.files.size} 个现有附件。重新全选后，会核实大小并自动补传；真实上传尚未验证。`;
        }).catch(error => { queue.paused = true; queue.message = error.message; queue.notify(); });
    }
    document.addEventListener('turbo:before-render', () => {
      if (controller?.queue?.running) controller.queue.paused = true;
      if (controller) document.removeEventListener('file-attachment-accept', controller.capture, true);
      controller = null;
    });
    document.addEventListener('turbo:load', mount);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true}); else mount();
  }
  return {UploadQueue, GitHubAdapter, StopError, UploadError, FileConflict, allowedPage, parseIndex, install};
});
