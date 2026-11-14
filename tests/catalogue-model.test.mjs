import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCatalogueModel} from '../tools/catalogue-model.mjs';
const data=JSON.parse(readFileSync(new URL('../books.json',import.meta.url))),model=createCatalogueModel(data);
test('legacy subjects and geometry resolve without creating duplicate categories',()=>{
 assert.equal(model.normalizeState({cat:'statistics'}).subcat,'probability-statistics');
 assert.equal(model.normalizeState({cat:'artificial-intelligence'}).cat,'artificial-intelligence');
 const s=model.normalizeState({cat:'university-math',subcat:'differential-geometry'});
 assert.equal(s.subcat,'geometry-topology');assert.equal(s.tag,'微分几何');
 assert(model.matches(data.books.find(b=>b.id==='bd-eb7d47b1ac45'),s));
 assert.equal(model.normalizeState({cat:'__proto__',subcat:'constructor',tag:'toString'}).cat,'all');
});
test('deduplicated filenames and author searches remain useful',()=>{
 for(const name of ['13.Abstract Algebra 3E','Dummit_Foote_Abstract_Algebra_3E','David S. Dummit, Richard M. Foote - Abstract Algebra, 3rd Edition   (2003, Wiley)']){
  for(const q of [name,name+'.pdf'])assert.deepEqual(data.books.filter(b=>model.matches(b,{q})).map(b=>b.id),['bd-ac70ba6c42a2']);
 }
 assert(model.matches(data.books.find(b=>b.id==='bd-8353d999e3be'),{q:'Durrett'}));
});
test('contextual tags count each book once and do not repeat subject navigation',()=>{
 const s=model.normalizeState({cat:'university-math',subcat:'probability-statistics'}),tags=model.tagGroups(data.books,s).flatMap(g=>g.tags);
 assert.equal(new Set(tags.map(t=>t.tag)).size,tags.length);assert(!tags.some(t=>t.tag==='概率与统计'));
 for(const row of tags)assert.equal(row.count,data.books.filter(b=>model.matches(b,{...s,tag:row.tag})).length);
 assert.equal(model.tagGroups(data.books,{q:'no-such-book'}).length,0);
});
test('catalogue has five math branches and valid unique records',()=>{
 assert.equal(data.subcategories.length,5);assert.equal(data.categoryGroups.flatMap(g=>g.ids).length,data.categories.length);
 const ids=new Set(),links=new Set();
 for(const b of data.books){
  assert(!ids.has(b.id));ids.add(b.id);assert(!links.has(b.ownerAccess.download));links.add(b.ownerAccess.download);
  assert.equal(model.categories.get(b.cat),b.catName);
  for(const s of b.subcats||[])assert(data.subcategories.some(v=>v.id===s&&(b.cats||[b.cat]).includes(v.parent)));
 }
});
