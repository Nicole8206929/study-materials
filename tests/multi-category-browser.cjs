const assert=require('node:assert/strict');
const {chromium,firefox}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const catalogue=require('../books.json');
(async()=>{
 const server=spawn('python3',['-m','http.server','8769','--bind','127.0.0.1'],{cwd:path.join(__dirname,'..'),stdio:'ignore'});
 try {
  for(let i=0;i<30;i++){try{if((await fetch('http://127.0.0.1:8769/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const original=catalogue.books.find(b=>b.cat==='high-school-physics')||catalogue.books[0];
  const book={...original,cats:[...new Set([original.cat,'university-physics','university-math'])],subcat:'analysis',subcats:['analysis','algebra'],tags:[...original.tags,'跨学科验收']};
  const fixture={...catalogue,books:catalogue.books.map(b=>b.id===book.id?book:b)};
  for(const [name,type] of Object.entries({chromium,firefox})){
   const browser=await type.launch();
   try {
    const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/books.json',r=>r.fulfill({json:fixture}));
    for(const cat of book.cats){
     await page.goto(`http://127.0.0.1:8769/?cat=${cat}`);
     await page.locator(`[data-id="${book.id}"]`).waitFor({timeout:5000});
     assert.equal(await page.locator(`[data-id="${book.id}"]`).count(),1);
     assert.equal(await page.locator(`.category[data-value="${cat}"] .category-count`).innerText(),String(fixture.books.filter(b=>(b.cats||[b.cat]).includes(cat)).length));
     await page.locator('#search').fill(book.title);assert(await page.locator(`[data-id="${book.id}"]`).isVisible());
    }
    for(const child of ['analysis','algebra']){
     await page.goto(`http://127.0.0.1:8769/?cat=university-math&subcat=${child}&tag=${encodeURIComponent('跨学科验收')}`);
     await page.locator(`[data-id="${book.id}"]`).waitFor({timeout:5000});
     assert.equal(await page.locator(`[data-id="${book.id}"] .owner-download`).getAttribute('href'),original.ownerAccess.download);
     await page.reload();await page.locator(`[data-id="${book.id}"]`).waitFor();
    }
    await page.goto('http://127.0.0.1:8769/');await page.waitForSelector('.book');
    assert.equal(await page.locator('.book').count(),catalogue.books.length);assert.deepEqual(errors,[]);
    console.log(`PASS ${name}: one book in all selected subjects and math branches, correct counts/search/tags, preserved download permission and no duplicate card.`);
   }finally{await browser.close();}
  }
 }finally{server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
