"use strict";

// This is a convenience gate, not authentication. Public files remain public.
const PASSWORD_HASH = "d2d05c17e708ca6134d5e66061e7cbd6cf989f3eb3476ead17028381e76cd68f";
const $ = id => document.getElementById(id);
const store = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* Private browsing may block storage. */ } }
};
let failures = 0;
let lockedUntil = 0;
let lockTimer;
let books = [];
let loaded = false;
let loading = false;
let state = { q: "", cat: "all", tag: "", format: "all", sort: "default" };

function enterLibrary() {
  $("gate").hidden = true;
  $("main").hidden = false;
  $("search").focus();
  if (!loaded) loadBooks();
}

function updateLock() {
  const seconds = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
  $("gatePwd").disabled = seconds > 0;
  $("gateSubmit").disabled = seconds > 0;
  $("gateErr").textContent = seconds ? `尝试次数过多，请 ${seconds} 秒后重试。` : "";
  if (!seconds) {
    clearInterval(lockTimer);
    failures = 0;
    $("gatePwd").focus();
  }
}

$("gateForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (Date.now() < lockedUntil) return;
  $("gateSubmit").disabled = true;
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode($("gatePwd").value));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (hash === PASSWORD_HASH) {
      store.set("authed", "1");
      $("gatePwd").value = "";
      enterLibrary();
    } else {
      failures += 1;
      $("gatePwd").value = "";
      $("gateErr").textContent = `密码不正确（${failures}/5），请重试。`;
      $("gatePwd").focus();
      if (failures >= 5) {
        lockedUntil = Date.now() + 30000;
        updateLock();
        lockTimer = setInterval(updateLock, 1000);
      }
    }
  } catch {
    $("gateErr").textContent = "浏览器无法验证密码，请使用支持 HTTPS 的现代浏览器，或从 GitHub 仓库浏览资料。";
  } finally {
    $("gateSubmit").disabled = Date.now() < lockedUntil;
  }
});

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function fileURL(path) {
  // Accept only relative local PDF/EPUB paths. Encode every segment, including # and quotes.
  if (typeof path !== "string" || /[\\\u0000-\u001f\u007f]/.test(path)) throw new Error("Invalid file path");
  const segments = path.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..") || !/\.(pdf|epub)$/i.test(path)) throw new Error("Invalid file path");
  return new URL(segments.map(encodeURIComponent).join("/"), new URL("./", location.href)).href;
}

function validateBook(book) {
  if (!book || ["id", "title", "author", "cat", "catName", "desc", "file"].some(key => typeof book[key] !== "string" || !book[key].trim())) throw new Error("Invalid catalogue entry");
  if (!Array.isArray(book.tags) || book.tags.some(tag => typeof tag !== "string")) throw new Error("Invalid tags");
  return { ...book, url: fileURL(book.file), format: book.file.split(".").pop().toLowerCase() };
}

async function loadBooks() {
  if (loading) return;
  loading = true;
  $("loadError").hidden = true;
  $("emptyState").hidden = true;
  $("books").setAttribute("aria-busy", "true");
  $("stats").textContent = "正在加载资料…";
  try {
    const response = await fetch("books.json", { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.books)) throw new Error("Invalid catalogue");
    books = data.books.map(validateBook);
    if (new Set(books.map(book => book.id)).size !== books.length) throw new Error("Duplicate IDs");
    loaded = true;
    readState();
    renderCategories();
    renderTags();
    render();
    const formats = [...new Set(books.map(book => book.format))];
    $("totalSummary").textContent = `${books.length} 份资料 · ${new Set(books.map(book => book.cat)).size} 个学科 · ${formats.map(format => format.toUpperCase()).join(" / ")}`;
  } catch {
    $("loadError").hidden = false;
    $("stats").textContent = "资料加载失败";
    $("totalSummary").textContent = "书架暂时无法加载";
    $("books").replaceChildren();
  } finally {
    loading = false;
    $("books").setAttribute("aria-busy", "false");
  }
}

function readState() {
  const params = new URL(location.href).searchParams;
  state = { q: params.get("q") || "", cat: params.get("cat") || "all", tag: params.get("tag") || "", format: params.get("format") || "all", sort: params.get("sort") || "default" };
  if (!books.some(book => book.cat === state.cat)) state.cat = "all";
  if (!["all", "pdf", "epub"].includes(state.format)) state.format = "all";
  if (!["default", "title", "year", "size"].includes(state.sort)) state.sort = "default";
  if (!books.some(book => (state.cat === "all" || book.cat === state.cat) && book.tags.includes(state.tag))) state.tag = "";
  $("search").value = state.q;
  $("format").value = state.format;
  $("sort").value = state.sort;
}

function saveState() {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(state)) {
    if (!value || value === "all" || value === "default") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  try { history.replaceState(null, "", url); } catch { /* Filtering works without history access. */ }
}

function filterButton(text, value, className, selected, onClick) {
  const button = node("button", className, text);
  button.type = "button";
  button.dataset.value = value;
  button.setAttribute("aria-pressed", String(selected));
  button.addEventListener("click", onClick);
  return button;
}

function renderCategories() {
  const categories = new Map([["all", "全部资料"], ...books.map(book => [book.cat, book.catName])]);
  $("categories").replaceChildren(...Array.from(categories, ([cat, name]) => {
    const count = cat === "all" ? books.length : books.filter(book => book.cat === cat).length;
    const button = filterButton(name, cat, "category", state.cat === cat, () => {
      state.cat = cat;
      state.tag = "";
      $("categories").querySelectorAll("button").forEach(item => item.setAttribute("aria-pressed", String(item.dataset.value === cat)));
      renderTags();
      render();
      saveState();
    });
    button.append(node("span", "category-count", String(count)));
    return button;
  }));
}

function renderTags() {
  const tags = [...new Set(books.filter(book => state.cat === "all" || book.cat === state.cat).flatMap(book => book.tags))];
  $("tagFilter").replaceChildren(...["", ...tags].map(tag => filterButton(tag || "全部标签", tag, "tag-chip", state.tag === tag, () => {
    state.tag = tag;
    $("tagFilter").querySelectorAll("button").forEach(item => item.setAttribute("aria-pressed", String(item.dataset.value === tag)));
    render();
    saveState();
  })));
}

function sizeBytes(book) {
  if (Number.isFinite(book.bytes)) return book.bytes;
  const match = String(book.size || "").match(/^([\d.]+)\s*(KB|MB|GB|B)$/i);
  return match ? Number(match[1]) * 1024 ** ({ B: 0, KB: 1, MB: 2, GB: 3 }[match[2].toUpperCase()]) : 0;
}

function bookCard(book) {
  const card = node("article", "book");
  card.dataset.id = book.id;
  const top = node("div", "book-top");
  top.append(node("span", "", book.catName), node("span", "book-number", String(books.indexOf(book) + 1).padStart(2, "0")));
  const meta = node("div", "meta");
  const labels = [book.format.toUpperCase(), book.size];
  if (Number.isInteger(book.pages) && book.pages > 0 && book.format === "pdf") labels.push(`${book.pages} 页`);
  if (book.year) labels.push(String(book.year));
  meta.append(...labels.filter(Boolean).map(label => node("span", "", label)));
  const actions = node("div", "actions");
  if (book.format === "pdf") {
    const preview = node("button", "view", "在线预览");
    preview.type = "button";
    preview.setAttribute("aria-label", `在线预览《${book.title}》`);
    preview.addEventListener("click", () => previewPDF(book));
    actions.append(preview);
  }
  const download = node("a", "download", `下载 ${book.format.toUpperCase()}`);
  download.href = book.url;
  download.download = book.file.split("/").pop();
  download.setAttribute("aria-label", `下载 ${book.format.toUpperCase()}：《${book.title}》`);
  actions.append(download);
  card.append(top, node("h3", "", book.title), node("p", "author", book.author), node("p", "desc", book.desc), meta, node("p", "book-tags", book.tags.join(" · ")), actions);
  if (book.format === "epub") card.append(node("p", "format-note", "电子书格式，请下载后用 EPUB 阅读器打开。"));
  else if (sizeBytes(book) > 30 * 1024 ** 2) card.append(node("p", "format-note", "较大文件，预览可能需要一些时间。"));
  return card;
}

function render() {
  if (!loaded) return;
  const terms = state.q.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = books.filter(book => {
    if (state.cat !== "all" && book.cat !== state.cat) return false;
    if (state.tag && !book.tags.includes(state.tag)) return false;
    if (state.format !== "all" && book.format !== state.format) return false;
    const haystack = [book.title, book.author, book.desc, book.catName, book.year, ...book.tags].join(" ").toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  });
  if (state.sort === "title") filtered.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  if (state.sort === "year") filtered.sort((a, b) => (b.year || 0) - (a.year || 0));
  if (state.sort === "size") filtered.sort((a, b) => sizeBytes(a) - sizeBytes(b));
  $("books").replaceChildren(...filtered.map(bookCard));
  $("emptyState").hidden = filtered.length !== 0;
  $("stats").textContent = `共 ${books.length} 份资料 · 当前显示 ${filtered.length} 份`;
}

function previewPDF(book) {
  $("previewTitle").textContent = book.title;
  $("previewFrame").title = `《${book.title}》PDF 预览`;
  $("previewFrame").src = book.url + "#toolbar=1&navpanes=0";
  $("previewOpen").href = book.url;
  $("previewDownload").href = book.url;
  $("previewDownload").download = book.file.split("/").pop();
  $("previewModal").showModal();
  $("previewClose").focus();
}

$("previewClose").addEventListener("click", () => $("previewModal").close());
$("previewModal").addEventListener("close", () => $("previewFrame").removeAttribute("src"));
$("previewModal").addEventListener("click", event => {
  if (event.target !== $("previewModal")) return;
  const rect = event.target.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
});
$("search").addEventListener("input", event => { state.q = event.target.value; render(); saveState(); });
$("clearSearch").addEventListener("click", () => { state.q = ""; $("search").value = ""; render(); saveState(); $("search").focus(); });
for (const id of ["format", "sort"]) $(id).addEventListener("change", event => { state[id] = event.target.value; render(); saveState(); });
function resetFilters() {
  state = { q: "", cat: "all", tag: "", format: "all", sort: "default" };
  $("search").value = "";
  $("format").value = "all";
  $("sort").value = "default";
  renderCategories(); renderTags(); render(); saveState(); $("search").focus();
}
$("resetFilters").addEventListener("click", resetFilters);
$("emptyReset").addEventListener("click", resetFilters);
$("retryLoad").addEventListener("click", loadBooks);
window.addEventListener("popstate", () => { if (loaded) { readState(); renderCategories(); renderTags(); render(); } });
if (store.get("authed") === "1") enterLibrary();
else $("gatePwd").focus();
