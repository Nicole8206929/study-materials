"use strict";

const $ = id => document.getElementById(id);
let books = [];
let loaded = false;
let loading = false;
let state = { q: "", cat: "all", tag: "", format: "all", sort: "default" };

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function previewURL(path) {
  if (typeof path !== "string" || !/^previews\/[A-Za-z0-9_-]+\/page-\d{3}\.webp$/.test(path)) throw new Error("Invalid preview path");
  return new URL(path, new URL("./", location.href)).href;
}

function validateBook(book) {
  if (!book || ["id", "title", "author", "cat", "catName", "desc"].some(key => typeof book[key] !== "string" || !book[key].trim())) throw new Error("Invalid catalogue entry");
  if (book.searchTitles !== undefined && (!Array.isArray(book.searchTitles) || book.searchTitles.some(title => typeof title !== "string"))) throw new Error("Invalid search titles");
  if (!Array.isArray(book.tags) || book.tags.some(tag => typeof tag !== "string")) throw new Error("Invalid tags");
  if (!["PDF", "EPUB"].includes(book.format)) throw new Error("Invalid format");
  if (book.file || book.url || book.downloadUrl) throw new Error("Public catalogue must not expose originals");
  if (!book.preview || !Array.isArray(book.preview.images) || !book.preview.images.length || book.preview.images.length > 20) throw new Error("Invalid preview");
  return { ...book, format: book.format.toLowerCase(), previewImages: book.preview.images.map(previewURL) };
}

async function loadBooks() {
  if (loading) return;
  loading = true;
  $("loadError").hidden = true;
  $("emptyState").hidden = true;
  $("books").setAttribute("aria-busy", "true");
  $("stats").textContent = "正在加载资料…";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("books.json", { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.books)) throw new Error("Invalid catalogue");
    books = data.books.map(validateBook);
    if (new Set(books.map(book => book.id)).size !== books.length) throw new Error("Duplicate IDs");
    loaded = true;
    readState();
    $("tagDetails").open = !matchMedia("(max-width: 600px)").matches || Boolean(state.tag);
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
    clearTimeout(timeout);
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
  $("tagSummary").textContent = `主题标签（${tags.length}）`;
  $("selectedTag").textContent = state.tag || "全部标签";
  $("tagFilter").replaceChildren(...["", ...tags].map(tag => filterButton(tag || "全部标签", tag, "tag-chip", state.tag === tag, () => {
    state.tag = tag;
    $("selectedTag").textContent = tag || "全部标签";
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
  const preview = node("button", "view", "查看试读");
  preview.type = "button";
  preview.setAttribute("aria-label", `查看试读《${book.title}》`);
  preview.addEventListener("click", () => previewBook(book));
  actions.append(preview);
  const access = node("div", "book-access");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", "M7 10V7a5 5 0 0 1 10 0v3M6 10h12v11H6zM12 14v3");
  icon.append(shape);
  access.append(icon, node("span", "", "原件已锁定"));
  card.append(top, node("h3", "", book.title), node("p", "author", book.author), node("p", "desc", book.desc), meta, node("p", "book-tags", book.tags.join(" · ")), access, actions);
  card.append(node("p", "format-note", `前 ${book.previewImages.length} 页试读 · 不提供原件下载`));

  return card;
}

function render() {
  if (!loaded) return;
  const terms = state.q.trim().normalize("NFKC").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = books.filter(book => {
    if (state.cat !== "all" && book.cat !== state.cat) return false;
    if (state.tag && !book.tags.includes(state.tag)) return false;
    if (state.format !== "all" && book.format !== state.format) return false;
    const haystack = [book.title, ...(book.searchTitles || [])].join(" ").normalize("NFKC").toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  });
  if (state.sort === "title") filtered.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  if (state.sort === "year") filtered.sort((a, b) => (b.year || 0) - (a.year || 0));
  if (state.sort === "size") filtered.sort((a, b) => sizeBytes(a) - sizeBytes(b));
  $("books").replaceChildren(...filtered.map(bookCard));
  $("emptyState").hidden = filtered.length !== 0;
  $("stats").textContent = `共 ${books.length} 份资料 · 当前显示 ${filtered.length} 份`;
}

function previewBook(book) {
  $("previewTitle").textContent = book.title;
  $("previewHelp").textContent = `当前展示前 ${book.previewImages.length} 页试读，完整原件已锁定。`;
  $("previewPages").replaceChildren(...book.previewImages.map((url, index) => {
    const figure = node("figure", "preview-page");
    const picture = node("img", "");
    picture.src = url;
    picture.alt = `《${book.title}》试读第 ${index + 1} 页`;
    picture.loading = index ? "lazy" : "eager";
    picture.decoding = "async";
    picture.addEventListener("error", () => { picture.hidden = true; figure.append(node("p", "", "此页暂时无法加载，请检查网络后重新打开试读。")); }, { once: true });
    figure.append(picture, node("figcaption", "", `第 ${index + 1} 页 · 试读`));
    return figure;
  }));
  $("previewModal").showModal();
  $("previewPages").scrollTop = 0;
  $("previewClose").focus();
}

$("previewClose").addEventListener("click", () => $("previewModal").close());
$("previewModal").addEventListener("close", () => $("previewPages").replaceChildren());
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
loadBooks();
