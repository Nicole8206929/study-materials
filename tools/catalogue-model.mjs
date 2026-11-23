// The catalogue supplies the subject tree, tag aliases and the original filenames.
const fold = value => String(value).normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '')
  .replace(/\.(?:pdf|epub|pptx?)(?=\s|$)/gu, '').replace(/[_./\\,，:：·・()（）【】\[\]–—-]+/gu, ' ')
  .replace(/\s+/gu, ' ').trim();

function searchIndex(fields) {
  const names = fields.filter(Boolean).map(fold);
  return {text: names.join('\n'), compact: names.map(name => name.replaceAll(' ', '')).join('\n')};
}

const hasTerm = (index, term) => index.text.includes(term) || index.compact.includes(term.replaceAll(' ', ''));

export function createCatalogueModel(data) {
  const categories = new Map(data.categories.map(c => [c.id, c.name]));
  const categoryTerms = new Map(data.categories.map(c => [c.id, [c.name, ...(c.searchNames || [])]]));
  const groups = new Map((data.categoryGroups || []).filter(g => g.id).map(g => [g.id, g]));
  const subcategories = data.subcategories || [];
  const branchNames = new Map(subcategories.map(s => [s.id, s.name]));
  const aliases = data.categoryAliases || {}, children = data.subcategoryAliases || {}, tagAliases = data.tagAliases || {};
  const canonicalTag = t => Object.hasOwn(tagAliases, t) ? tagAliases[t] : t;
  const tagNames = new Map();
  for (const [alias, tag] of Object.entries(tagAliases)) {
    if (!tagNames.has(tag)) tagNames.set(tag, [tag]);
    tagNames.get(tag).push(alias);
  }
  const aliasTerms = new Map();
  for (const names of tagNames.values()) {
    const alternatives = names.map(fold);
    for (const name of alternatives) aliasTerms.set(name, alternatives);
  }
  const namesOfTag = tag => tagNames.get(tag) || [tag];
  const tagsOf = b => [...new Set(b.tags.map(canonicalTag))];
  const catsOf = b => b.cats || [b.cat], subsOf = b => b.subcats || (b.subcat ? [b.subcat] : []);
  const inGroup = (b, group) => catsOf(b).some(cat => group.ids.includes(cat));
  const records = new WeakMap();
  function indexOf(book) {
    if (!records.has(book)) records.set(book, searchIndex([
      book.title, book.author, ...(book.searchTitles || []), ...tagsOf(book).flatMap(namesOfTag),
      ...catsOf(book).flatMap(cat => categoryTerms.get(cat) || []), ...subsOf(book).map(id => branchNames.get(id))
    ]));
    return records.get(book);
  }

  const normalizeState = input => {
    const s = {q:'', group:'', cat:'all', subcat:'', tag:'', format:'all', sort:'default', ...input};
    if (Object.hasOwn(aliases, s.cat)) Object.assign(s, aliases[s.cat]);
    if (Object.hasOwn(children, s.subcat)) Object.assign(s, children[s.subcat]);
    if (!categories.has(s.cat)) s.cat = 'all';
    if (s.cat !== 'all' || !groups.has(s.group)) s.group = '';
    if (!subcategories.some(c => c.id === s.subcat && c.parent === s.cat)) s.subcat = '';
    s.tag = canonicalTag(s.tag);
    if (!['all','pdf','epub'].includes(s.format)) s.format = 'all';
    if (!['default','title','year','size'].includes(s.sort)) s.sort = 'default';
    return s;
  };

  function filterFor(input, {ignoreTag = false} = {}) {
    const s = normalizeState(input);
    const group = groups.get(s.group);
    const terms = s.q.trim().split(/\s+/u).map(fold).filter(Boolean).map(term => aliasTerms.get(term) || [term]);
    return book => {
      if (group && !inGroup(book, group)) return false;
      if (s.cat !== 'all' && !catsOf(book).includes(s.cat)) return false;
      if (s.subcat && !subsOf(book).includes(s.subcat)) return false;
      if (!ignoreTag && s.tag && !tagsOf(book).includes(s.tag)) return false;
      if (s.format !== 'all' && book.format.toLowerCase() !== s.format) return false;
      return !terms.length || terms.every(choices => choices.some(term => hasTerm(indexOf(book), term)));
    };
  }

  const redundant = new Set([...categories.values(), ...branchNames.values(), '数学竞赛','物理','英语','生物','高中','管理学']);
  const fixedGroups = (data.tagGroups || []).map(g => ({name:g.name, tags:[...new Set(g.tags.map(canonicalTag))]}));
  const assigned = new Set(fixedGroups.flatMap(g => g.tags));
  function tagGroups(books, state, query = '') {
    const counts = new Map();
    for (const book of books.filter(filterFor(state, {ignoreTag:true}))) {
      for (const tag of tagsOf(book)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    const sections = [...fixedGroups];
    sections.splice(1, 0, {name:'知识主题', tags:[...counts.keys()].filter(t => !assigned.has(t))});
    const terms = fold(query).split(' ').filter(Boolean);
    return sections.map(g => ({
      name: g.name,
      tags: g.tags.filter(t => counts.has(t) && (!redundant.has(t) || state.tag === t)
          && (!terms.length || terms.every(term => hasTerm(searchIndex(namesOfTag(t)), term))))
        .map(tag => ({tag, count:counts.get(tag)}))
        .sort((a,b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'))
    })).filter(g => g.tags.length);
  }
  return {categories, groups, subcategories, normalizeState, filterFor, matches:(b, s, options) => filterFor(s, options)(b), tagGroups, tagsOf, inGroup};
}
