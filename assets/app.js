"use strict";
import {initializeShelfManagement} from '../tools/shelf-management.mjs';
import {createCatalogueModel} from '../tools/catalogue-model.mjs';

const $ = id => document.getElementById(id);
let books = [];
let allBooks = [];
let management;
let managementReady;
const getManagement=()=>managementReady||=initializeShelfManagement({
  onChange:removed=>{books=allBooks.filter(book=>!removed.has(book.id));refreshCatalogue();},
  onModeChange:()=>{if(loaded)render();}
}).then(value=>management=value);
let model;
let categoryGroups=[];
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
    model=createCatalogueModel(data);
    categoryGroups=data.categoryGroups||[];
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
    $("tagDetails").open=Boolean(state.tag);
    $("subjectDetails").open=!matchMedia("(max-width: 800px)").matches;
    saveState();
    renderCategories();
    renderSubcategories();
    renderTags();
    render();
    updateSummary();
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
  if(state.tag&&!books.some(book=>inCategory(book,state.cat)&&model.tagsOf(book).includes(state.tag)))state.tag='';
  renderCategories();renderSubcategories();renderTags();render();saveState();
  updateSummary();
}
function updateSummary(){
  $("totalSummary").textContent=books.length+" 份资料，按 "+categories.size+" 个学科整理";
}

function readState() {
  const params = new URL(location.href).searchParams;
  state = { q: params.get("q") || "", cat: params.get("cat") || "all", subcat: params.get('subcat') || '', tag: params.get("tag") || "", format: params.get("format") || "all", sort: params.get("sort") || "default" };
  state=model.normalizeState(state);
  if(!books.some(book=>inCategory(book,state.cat)&&(!state.subcat||bookSubcategories(book).includes(state.subcat))&&model.tagsOf(book).includes(state.tag)))state.tag="";
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
  const make=(cat,name)=>{
    const count=books.filter(book=>inCategory(book,cat)).length;
    const button=filterButton(name,cat,"category",state.cat===cat,()=>{
      state.cat=cat;state.subcat='';state.tag='';$("tagSearch").value='';
      $("categories").querySelectorAll("button").forEach(item=>item.setAttribute("aria-pressed",String(item.dataset.value===cat)));
      if(matchMedia("(max-width: 800px)").matches){$("subjectDetails").open=false;$("subjectDetails").querySelector("summary").focus();}
      renderSubcategories();renderTags();render();saveState();
    });
    button.append(node("span","category-count",String(count)));return button;
  };
  const used=new Set(),groups=categoryGroups.map(group=>{
    const section=node('div','category-group');section.append(node('h2','',group.name));
    const list=node('div','category-list');
    for(const cat of group.ids)if(categories.has(cat)&&!used.has(cat)){list.append(make(cat,categories.get(cat)));used.add(cat);}
    section.append(list);return section;
  });
  const remaining=[...categories].filter(([id])=>!used.has(id)).map(([id,name])=>make(id,name));
  $("categories").replaceChildren(make('all','全部资料'),...groups,...remaining);
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
  const groups=model.tagGroups(books,state,$("tagSearch").value.trim());
  const allCount=model.tagGroups(books,state).reduce((n,g)=>n+g.tags.length,0);
  $("tagSummary").textContent="按标签细分（"+allCount+"）";
  $("selectedTag").textContent=state.tag||"机构、主题、用途";
  const select=tag=>{
    state.tag=tag;renderTags();render();saveState();
    [...$("tagFilter").querySelectorAll('button')].find(b=>b.dataset.value===tag)?.focus();
  };
  const sections=groups.map(group=>{
    const section=node('section','facet-group');section.append(node('h3','',group.name));
    const list=node('div','facet-options');
    for(const {tag,count}of group.tags){const button=filterButton(tag,tag,'tag-chip',state.tag===tag,()=>select(tag));button.append(node('span','tag-count',String(count)));list.append(button);}
    section.append(list);return section;
  });
  $("tagFilter").replaceChildren(filterButton('全部标签','','tag-chip',!state.tag,()=>select('')),...sections);
  if(!groups.length)$("tagFilter").append(node('p','muted','当前条件下没有匹配的标签。'));
}

function sizeBytes(book) {
  if (Number.isFinite(book.bytes)) return book.bytes;
  const match = String(book.size || "").match(/^([\d.]+)\s*(KB|MB|GB|B)$/i);
  return match ? Number(match[1]) * 1024 ** ({ B: 0, KB: 1, MB: 2, GB: 3 }[match[2].toUpperCase()]) : 0;
}

function bookCard(book) {
  const card = node("article", "book");
  card.dataset.id = book.id;
  card.dataset.subject=book.cat;
  const top = node("div", "book-top");
  top.append(node("span","",bookCategories(book).map(c=>categories.get(c)||book.catName).join(' / ')));
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
    for (const [key,label,css] of [['view','查看原件','owner-view'],['download','本人下载','owner-download']]) {
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
  access.append(icon,node("span","","完整原件仅本人可用"));
  const details=node('details','book-details');
  details.append(node('summary','','简介与标签'),node('p','desc',book.desc));
  const bookTags=node('div','book-tags');
  for(const tag of model.tagsOf(book)){
    const button=filterButton(tag,tag,'book-tag',false,()=>{
      state.tag=tag;state.q='';$('search').value='';$('tagSearch').value='';
      renderTags();render();saveState();$('resultsTitle').scrollIntoView({block:'start'});$('search').focus({preventScroll:true});
    });bookTags.append(button);
  }
  details.append(bookTags);
  const heading=node('div','book-heading');
  heading.append(top,node("h3","",book.title),node("p","author",book.author));
  const branches=bookSubcategories(book).map(id=>subcategories.find(s=>s.id===id)?.name).filter(Boolean);
  if(branches.length)heading.append(node('p','book-branches',branches.join(' / ')));
  card.append(heading,meta,details,access,actions);
  card.append(node("p","format-note","访客试读 "+book.previewImages.length+" 页"+(book.ownerAccess?"；本人入口验证 GitHub 权限":"；完整文件保持私有")));

  return card;
}

function render() {
  if (!loaded) return;
  const filtered=books.filter(book=>model.matches(book,state));
  if(state.sort==='default'){
    const rank=[...categories.keys()];
    filtered.sort((a,b)=>(state.cat==='all'?rank.indexOf(a.cat)-rank.indexOf(b.cat):0)||a.title.localeCompare(b.title,'zh-CN'));
  }
  if (state.sort === "title") filtered.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  if (state.sort === "year") filtered.sort((a, b) => (b.year || 0) - (a.year || 0));
  if (state.sort === "size") filtered.sort((a, b) => sizeBytes(a) - sizeBytes(b));
  $("books").replaceChildren(...filtered.map(bookCard));
  $("emptyState").hidden = filtered.length !== 0;
  const emptyCategory = state.cat !== "all" && !books.some(book => inCategory(book,state.cat));
  const emptySubcategory=state.subcat&&!books.some(b=>inCategory(b,state.cat)&&bookSubcategories(b).includes(state.subcat));
  $("emptyStateTitle").textContent = emptySubcategory ? `${subcategories.find(s=>s.id===state.subcat)?.name}暂未添加书籍` : emptyCategory ? `${categories.get(state.cat)}暂未添加书籍` : "还没有找到匹配的资料";
  $("emptyStateHint").textContent = emptyCategory ? "分类已建立，添加对应书籍后会显示在这里。" : "试试更短的关键词，或重置分类、格式和标签。";
  $("stats").textContent="当前 "+filtered.length+" 份 / 全架 "+books.length+" 份";
  const categoryName=categories.get(state.cat)||'全部资料';
  $("currentCategory").textContent=categoryName;
  $("resultsTitle").textContent=state.subcat?categoryName+" / "+subcategories.find(s=>s.id===state.subcat).name:categoryName;
  const active=[];
  const add=(label,key)=>active.push(filterButton(label+" ×",key,'active-filter',false,()=>{
    state[key]=key==='cat'||key==='format'?'all':key==='sort'?'default':'';
    if(key==='cat'){state.subcat='';state.tag='';}if(key==='subcat')state.tag='';
    $("search").value=state.q;$("format").value=state.format;$("sort").value=state.sort;
    renderCategories();renderSubcategories();renderTags();render();saveState();$("search").focus();
  }));
  if(state.q)add("搜索："+state.q,'q');
  if(state.tag)add(state.tag,'tag');
  if(state.format!=='all')add(state.format.toUpperCase(),'format');
  $("activeFilters").replaceChildren(...active);$("activeFilters").hidden=!active.length;
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
$("search").addEventListener("input", event => { state.q = event.target.value; renderTags();render(); saveState(); });
$("clearSearch").addEventListener("click", () => { state.q = ""; $("search").value = ""; renderTags();render(); saveState(); $("search").focus(); });
for (const id of ["format", "sort"]) $(id).addEventListener("change", event => { state[id] = event.target.value; renderTags();render(); saveState(); });
$("tagSearch").addEventListener("input",renderTags);
function resetFilters() {
  $("tagSearch").value="";
  state = { q: "", cat: "all", subcat: "", tag: "", format: "all", sort: "default" };
  $("search").value = "";
  $("format").value = "all";
  $("sort").value = "default";
  renderCategories(); renderSubcategories();renderTags(); render(); saveState(); $("search").focus();
}
$("resetFilters").addEventListener("click", resetFilters);
$("emptyReset").addEventListener("click", resetFilters);
$("retryLoad").addEventListener("click", loadBooks);
const narrowScreen=matchMedia('(max-width: 800px)');
narrowScreen.addEventListener('change',event=>{$('subjectDetails').open=!event.matches;});
window.addEventListener("popstate", () => { if (loaded) { readState(); renderCategories();renderSubcategories(); renderTags(); render(); } });
loadBooks();
