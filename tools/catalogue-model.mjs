// Canonical classification, search and contextual facets share one catalogue definition.
export function createCatalogueModel(data) {
  const categories=new Map(data.categories.map(c=>[c.id,c.name])), subcategories=data.subcategories||[];
  const aliases=data.categoryAliases||{}, children=data.subcategoryAliases||{}, tagAliases=data.tagAliases||{};
  const canonicalTag=t=>Object.hasOwn(tagAliases,t)?tagAliases[t]:t;
  const tagsOf=b=>[...new Set(b.tags.map(canonicalTag))];
  const catsOf=b=>b.cats||[b.cat], subsOf=b=>b.subcats||(b.subcat?[b.subcat]:[]);
  const normalize=t=>String(t).normalize('NFKC').toLocaleLowerCase().replace(/\.(?:pdf|epub|pptx?)(?=\s|$)/g,'');
  const normalizeState=input=>{
    const s={q:'',cat:'all',subcat:'',tag:'',format:'all',sort:'default',...input};
    if(Object.hasOwn(aliases,s.cat))Object.assign(s,aliases[s.cat]);
    if(Object.hasOwn(children,s.subcat))Object.assign(s,children[s.subcat]);
    if(!categories.has(s.cat))s.cat='all';
    if(!subcategories.some(c=>c.id===s.subcat&&c.parent===s.cat))s.subcat='';
    s.tag=canonicalTag(s.tag);
    if(!['all','pdf','epub'].includes(s.format))s.format='all';
    if(!['default','title','year','size'].includes(s.sort))s.sort='default';
    return s;
  };
  const matches=(b,input,{ignoreTag=false}={})=>{
    const s=normalizeState(input);
    if(s.cat!=='all'&&!catsOf(b).includes(s.cat))return false;
    if(s.subcat&&!subsOf(b).includes(s.subcat))return false;
    if(!ignoreTag&&s.tag&&!tagsOf(b).includes(s.tag))return false;
    if(s.format!=='all'&&b.format.toLowerCase()!==s.format)return false;
    const terms=normalize(s.q.trim()).split(/\s+/).filter(Boolean);
    const text=normalize([b.title,b.author,...(b.searchTitles||[]),...tagsOf(b),...catsOf(b).map(c=>categories.get(c)||''),...subsOf(b).map(id=>subcategories.find(s=>s.id===id)?.name||'')].join(' '));
    return terms.every(t=>text.includes(t));
  };
  const tagGroups=(books,state,query='')=>{
    const counts=new Map();
    for(const b of books.filter(b=>matches(b,state,{ignoreTag:true})))for(const tag of tagsOf(b))counts.set(tag,(counts.get(tag)||0)+1);
    const redundant=new Set([...categories.values(),...subcategories.map(s=>s.name),'数学竞赛','物理','英语','生物','高中','管理学']);
    const assigned=new Set(),groups=(data.tagGroups||[]).map(g=>{const tags=[...new Set(g.tags.map(canonicalTag))];tags.forEach(t=>assigned.add(t));return {name:g.name,tags};});
    groups.splice(1,0,{name:'知识主题',tags:[...counts.keys()].filter(t=>!assigned.has(t))});
    return groups.map(g=>({name:g.name,tags:g.tags.filter(t=>counts.has(t)&&(!redundant.has(t)||state.tag===t)&&normalize(t).includes(normalize(query))).map(tag=>({tag,count:counts.get(tag)})).sort((a,b)=>b.count-a.count||a.tag.localeCompare(b.tag,'zh-CN'))})).filter(g=>g.tags.length);
  };
  return {categories,subcategories,normalizeState,matches,tagGroups,tagsOf};
}
