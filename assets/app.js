"use strict";
import {initializeShelfManagement} from '../tools/shelf-management.mjs';

const $ = id => document.getElementById(id);
let books = [];
let allBooks = [];
let management;
let managementReady;
const getManagement=()=>managementReady||=initializeShelfManagement({
  onChange:removed=>{books=allBooks.filter(book=>!removed.has(book.id));refreshCatalogue();},
  onModeChange:()=>{if(loaded)render();}
}).then(value=>management=value);
let categories = new Map();
let subcategories = [];
let loaded = false;
let loading = false;
let state = { q: "", cat: "all", subcat: "", tag: "", format: "all", sort: "default" };
const bookCategories=book=>book.cats||[book.cat];
const bookSubcategories=book=>book.subcats||(book.subcat?[book.subcat]:[]);
const inCategory=(book,cat)=>cat==='all'||bookCategories(book).includes(cat);

function protectedOwnerAccess(access) {
  if (!access) return null;
  if (access.provider !== 'github-private') throw new Error('Invalid owner access');
  for (const key of ['view','download']) {
    const url = new URL(access[key]);
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash ||
        !url.pathname.startsWith('/Nicole8206929/study-materials-originals/') ||
        !/^\/(?:Nicole8206929\/study-materials-originals)\/(?:blob\/|raw\/|releases\/(?:tag|download)\/)/.test(url.pathname) ||
        decodeURIComponent(url.pathname).split('/').some(p=>p==='..'||/[\x00-\x1f]/.test(p))) throw new Error('Unprotected original link rejected');
  }
  return access;
}

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
  if(book.cats!==undefined&&(!Array.isArray(book.cats)||!book.cats.length||book.cats[0]!==book.cat||book.cats.some(c=>typeof c!=='string')||new Set(book.cats).size!==book.cats.length))throw new Error('Invalid category memberships');
  if(book.subcats!==undefined&&(!Array.isArray(book.subcats)||book.subcats.some(s=>typeof s!=='string')||new Set(book.subcats).size!==book.subcats.length||(book.subcat&&book.subcats[0]!==book.subcat)))throw new Error('Invalid subcategory memberships');
  if (!["PDF", "EPUB"].includes(book.format)) throw new Error("Invalid format");
  if (book.file || book.url || book.downloadUrl) throw new Error("Public catalogue must not expose originals");
  protectedOwnerAccess(book.ownerAccess);
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
    const response = await fetch("books.json", { signal: controller.signal, cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.books)) throw new Error("Invalid catalogue");
    allBooks = data.books.map(validateBook);
    await getManagement();
    const removed=await management.visibility();
    books = allBooks.filter(book=>!removed.has(book.id));
    if (new Set(books.map(book => book.id)).size !== books.length) throw new Error("Duplicate IDs");
    const declared = data.categories || [];
    if (!Array.isArray(declared) || declared.some(category => !category || typeof category.id !== "string" || category.id === "all" || !category.id.trim() || typeof category.name !== "string" || !category.name.trim())) throw new Error("Invalid categories");
    categories = new Map(declared.map(category => [category.id, category.name]));
    subcategories = data.subcategories || [];
    if (!Array.isArray(subcategories) || subcategories.some(s=>!s.id||!s.name||!categories.has(s.parent))) throw new Error('Invalid subcategories');
    if (categories.size !== declared.length) throw new Error("Duplicate category IDs");
    books.forEach(book => { if (!categories.has(book.cat)) categories.set(book.cat, book.catName); });
    books.forEach(book=>{
      if(bookCategories(book).some(c=>!categories.has(c))||bookSubcategories(book).some(child=>!subcategories.some(s=>s.id===child&&bookCategories(book).includes(s.parent))))throw new Error('Invalid book classification');
    });
    loaded = true;
    readState();
    $("tagDetails").open = !matchMedia("(max-width: 600px)").matches || Boolean(state.tag);
    renderCategories();
    renderSubcategories();
    renderTags();
    render();
    const formats = [...new Set(books.map(book => book.format))];
    $("totalSummary").textContent = `${books.length} 份资料 · ${categories.size} 个分类 · ${formats.map(format => format.toUpperCase()).join(" / ")}`;
  } catch {
    if(!management)managementReady=null;
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

function refreshCatalogue(){
  if(state.tag&&!books.some(book=>inCategory(book,state.cat)&&book.tags.includes(state.tag)))state.tag='';
  renderCategories();renderSubcategories();renderTags();render();saveState();
  const formats=[...new Set(books.map(book=>book.format))];
  $("totalSummary").textContent=`${books.length} 份资料 · ${categories.size} 个分类 · ${formats.length?formats.map(format=>format.toUpperCase()).join(" / "):"无资料"}`;
}

function readState() {
  const params = new URL(location.href).searchParams;
  state = { q: params.get("q") || "", cat: params.get("cat") || "all", subcat: params.get('subcat') || '', tag: params.get("tag") || "", format: params.get("format") || "all", sort: params.get("sort") || "default" };
  if (!categories.has(state.cat)) state.cat = "all";
  if (!subcategories.some(s=>s.parent===state.cat&&s.id===state.subcat)) state.subcat='';
  if (!["all", "pdf", "epub"].includes(state.format)) state.format = "all";
  if (!["default", "title", "year", "size"].includes(state.sort)) state.sort = "default";
  if (!books.some(book => inCategory(book,state.cat) && (!state.subcat||bookSubcategories(book).includes(state.subcat)) && book.tags.includes(state.tag))) state.tag = "";
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
  const options = new Map([["all", "全部资料"], ...categories]);
  $("categories").replaceChildren(...Array.from(options, ([cat, name]) => {
    const count = books.filter(book => inCategory(book,cat)).length;
    const button = filterButton(name, cat, "category", state.cat === cat, () => {
      state.cat = cat;
      state.subcat = '';
      state.tag = "";
      $("categories").querySelectorAll("button").forEach(item => item.setAttribute("aria-pressed", String(item.dataset.value === cat)));
      renderSubcategories();renderTags();
      render();
      saveState();
    });
    button.append(node("span", "category-count", String(count)));
    return button;
  }));
}

function renderSubcategories() {
  const choices=subcategories.filter(s=>s.parent===state.cat);
  $('subcategorySection').hidden=!choices.length;
  $('subcategories').replaceChildren(...[{id:'',name:'全部'},...choices].map(s=>{
    const count=books.filter(b=>inCategory(b,state.cat)&&(!s.id||bookSubcategories(b).includes(s.id))).length;
    return filterButton(`${s.name} ${count}`,s.id,'tag-chip subcategory',state.subcat===s.id,()=>{
      state.subcat=s.id;state.tag='';renderSubcategories();renderTags();render();saveState();
    });
  }));
}

function renderTags() {
  const tags = [...new Set(books.filter(book => inCategory(book,state.cat)&&(!state.subcat||bookSubcategories(book).includes(state.subcat))).flatMap(book => book.tags))];
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
  top.append(node("span", "", bookCategories(book).map(c=>categories.get(c)||book.catName).join(' · ')), node("span", "book-number", String(books.indexOf(book) + 1).padStart(2, "0")));
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
  if (book.ownerAccess) {
    for (const [key,label,css] of [['view','本人查看原件','owner-view'],['download','本人下载原件','owner-download']]) {
      const link=node('a',css,label);link.href=book.ownerAccess[key];link.target='_blank';link.rel='noopener noreferrer';
      link.setAttribute('aria-label',`${label}《${book.title}》（GitHub 验证权限）`);actions.append(link);
    }
  }
  if(management?.canManage){
    const remove=node('button','delete-book','删除书籍');remove.type='button';remove.setAttribute('aria-label',`删除《${book.title}》`);remove.addEventListener('click',()=>management.remove(book));actions.append(remove);
  }
  const access = node("div", "book-access");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", "M7 10V7a5 5 0 0 1 10 0v3M6 10h12v11H6zM12 14v3");
  icon.append(shape);
  access.append(icon, node("span", "", "原件已锁定"));
  card.append(top, node("h3", "", book.title), node("p", "author", book.author), node("p", "desc", book.desc), meta, node("p", "book-tags", book.tags.join(" · ")), access, actions);
  card.append(node("p", "format-note", `访客试读前 ${book.previewImages.length} 页${book.ownerAccess?' · 本人入口由 GitHub 验证权限':' · 完整文件保持私有'}`));

  return card;
}

function render() {
  if (!loaded) return;
  const terms = state.q.trim().normalize("NFKC").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = books.filter(book => {
    if (!inCategory(book,state.cat)) return false;
    if (state.subcat && !bookSubcategories(book).includes(state.subcat)) return false;
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
  const emptyCategory = state.cat !== "all" && !books.some(book => inCategory(book,state.cat));
  const emptySubcategory=state.subcat&&!books.some(b=>inCategory(b,state.cat)&&bookSubcategories(b).includes(state.subcat));
  $("emptyStateTitle").textContent = emptySubcategory ? `${subcategories.find(s=>s.id===state.subcat)?.name}暂未添加书籍` : emptyCategory ? `${categories.get(state.cat)}暂未添加书籍` : "还没有找到匹配的资料";
  $("emptyStateHint").textContent = emptyCategory ? "分类已建立，添加对应书籍后会显示在这里。" : "试试更短的关键词，或重置分类、格式和标签。";
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
  state = { q: "", cat: "all", subcat: "", tag: "", format: "all", sort: "default" };
  $("search").value = "";
  $("format").value = "all";
  $("sort").value = "default";
  renderCategories(); renderSubcategories();renderTags(); render(); saveState(); $("search").focus();
}
$("resetFilters").addEventListener("click", resetFilters);
$("emptyReset").addEventListener("click", resetFilters);
$("retryLoad").addEventListener("click", loadBooks);
window.addEventListener("popstate", () => { if (loaded) { readState(); renderCategories();renderSubcategories(); renderTags(); render(); } });
loadBooks();
