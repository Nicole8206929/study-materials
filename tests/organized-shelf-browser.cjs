const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),path=require('node:path'),{chromium,firefox}=require('playwright'),{AxeBuilder}=require('@axe-core/playwright');
const data=require('../books.json');
(async()=>{const server=spawn('python3',['-m','http.server','8782','--bind','127.0.0.1'],{cwd:path.join(__dirname,'..'),stdio:'ignore'});try{
 for(let n=0;n<30;n++){try{if((await fetch('http://127.0.0.1:8782/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 for(const [engine,type]of Object.entries({chromium,firefox})){
  const browser=await type.launch({headless:true});try{
   const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
   await context.route('**/upload-service.json',r=>r.fulfill({json:{version:1,ready:false}}));page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:8782/');await page.waitForSelector('.book');
   assert.equal(await page.locator('#subjectDetails').getAttribute('open'),null);
   await page.locator('#subjectDetails summary').click();await page.locator('.category[data-value="university-math"]').click();
   assert.equal(await page.locator('#subjectDetails').getAttribute('open'),null);assert.equal(await page.locator('#currentCategory').innerText(),'大学数学');
   await page.locator('.subcategory[data-value="probability-statistics"]').click();
   for(const id of ['openintro-stats','bd-8353d999e3be','bd-7f4666c08ea6'])assert(await page.locator('.book[data-id="'+id+'"]').isVisible());
   await page.goto('http://127.0.0.1:8782/?cat=university-math&subcat=differential-geometry');await page.waitForSelector('.book');
   assert.equal(new URL(page.url()).searchParams.get('subcat'),'geometry-topology');assert.equal(new URL(page.url()).searchParams.get('tag'),'微分几何');
   await page.goto('http://127.0.0.1:8782/?cat=artificial-intelligence');await page.waitForSelector('.book');assert.equal(await page.locator('.book').count(),8);
   await page.goto('http://127.0.0.1:8782/?cat=statistics');await page.waitForSelector('.book');assert(await page.locator('.book[data-id="openintro-stats"]').isVisible());
   await page.locator('#resetFilters').click();await page.locator('#search').fill('13.Abstract Algebra 3E.pdf');assert.equal(await page.locator('.book').count(),1);
   assert.equal(await page.locator('.book').getAttribute('data-id'),'bd-ac70ba6c42a2');
   await page.locator('.book-details summary').click();assert((await page.locator('.book .desc').innerText()).includes('三个完全相同'));
   await page.locator('.view').click();await page.waitForFunction(()=>document.querySelector('#previewPages img')?.naturalWidth>0);assert.equal(await page.locator('#previewPages img').count(),10);await page.locator('#previewClose').click();
   await page.locator('#clearSearch').click();await page.locator('#tagDetails summary').click();await page.locator('#tagSearch').fill('九学');await page.locator('#tagFilter .tag-chip[data-value="九学"]').click();
   const ids=await page.locator('.book').evaluateAll(nodes=>nodes.map(n=>n.dataset.id));assert.equal(ids.length,new Set(ids).size);assert(ids.includes('upload-735645128'));
   await page.locator('.active-filter[data-value="tag"]').click();assert.equal(await page.locator('.book').count(),data.books.length);
   await page.locator('#tagSearch').fill('not-a-tag');assert((await page.locator('#tagFilter').innerText()).includes('没有匹配'));
   await page.locator('#resetFilters').click();await page.locator('#search').fill('not-a-real-book');assert(await page.locator('#emptyState').isVisible());await page.locator('#emptyReset').click();
   for(const scheme of ['light','dark']){
    await page.emulateMedia({colorScheme:scheme});await page.locator('#tagDetails').evaluate(el=>el.open=true);await page.locator('#tagSearch').fill('');
    for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
   }
   await page.setViewportSize({width:390,height:844});assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
   await page.locator('#search').fill('Quantitative Trading');assert.equal(await page.locator('.book[data-id="qf-quanttrading"] .owner-download').getAttribute('href'),data.books.find(b=>b.id==='qf-quanttrading').ownerAccess.download);
   await page.goto('http://127.0.0.1:8782/upload.html?legacyUpload=1&cat=statistics');await page.waitForSelector('#uploadSubcategories input[value="probability-statistics"]');
   assert(await page.locator('#uploadCategories input[value="university-math"]').isChecked());assert(await page.locator('#uploadSubcategories input[value="probability-statistics"]').isChecked());
   assert.deepEqual(errors,[]);console.log('PASS '+engine+': organized mobile catalogue, legacy URLs, contextual tags, unique search, original download, preview, upload aliases and accessibility.');
  }finally{await browser.close();}
 }
}finally{server.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
