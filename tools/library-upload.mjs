export const batchPattern=/^upload-\d{8,14}-[a-f0-9]{8,32}$/;

export function makeUploadRelease(input,categories,{stamp,random}={}) {
  const selected=input.cats ?? (input.cat?[input.cat]:[]);
  if (!Array.isArray(selected) || !selected.length || selected.some(id=>!categories.some(c=>c.id===id))) throw new Error('请至少选择一个有效的书架分类。');
  const cats=Array.from(new Set(selected));
  const chosenChildren=input.subcats ?? (input.subcat?[input.subcat]:[]);
  if (!Array.isArray(chosenChildren) || chosenChildren.some(id=>typeof id!=='string'||!/^[a-z][a-z0-9-]*$/.test(id)) ||
      (chosenChildren.length&&!cats.includes('university-math'))) throw new Error('请检查大学数学小分类。');
  const subcats=Array.from(new Set(chosenChildren));
  const tags=Array.from(new Set((input.tags||'').split(/[,，;；\n]/).map(t=>t.trim()).filter(Boolean)));
  const title=(input.title||'').trim(),expectedCount=Number(input.expectedCount||0);
  if (tags.length>10 || tags.some(t=>t.length>40 || /[\x00-\x1f]/.test(t))) throw new Error('最多添加 10 个标签，每个不超过 40 字。');
  if (!['individual','merge'].includes(input.mode) || title.length>120 || /[\x00-\x1f]/.test(title)) throw new Error('请检查书名和整理方式。');
  if (input.mode==='merge' && !title) throw new Error('请给合订资料填写书名。');
  if (!Number.isInteger(expectedCount) || expectedCount<0 || expectedCount>1000) throw new Error('文件数请填 1—1000，或留空。');
  stamp ||= new Date().toISOString().replace(/\D/g,'').slice(0,14);
  random ||= Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>n.toString(16).padStart(2,'0')).join('');
  const batch=`upload-${stamp}-${random}`;
  if (!batchPattern.test(batch)) throw new Error('无法生成上传批次，请重试。');
  const spec={version:1,cat:cats[0],cats,tags,mode:input.mode,title,expectedCount};
  if (subcats.length) {
    spec.subcat=subcats[0];spec.subcats=subcats;
  }
  const category=cats.map(id=>categories.find(c=>c.id===id).name).join('、');
  const encoded=JSON.stringify(spec).replaceAll('<','\\u003c').replaceAll('>','\\u003e');
  const body=`分类：${category}\n标签：${tags.join('、')||'无'}\n\n请添加 PDF、EPUB、PPT 或 PPTX。等每个附件上传成功，再点 Publish release（发布）。本仓库是私有的，发布不会公开完整文件。发布后返回书架上传页查看结果，无需保存到草稿或回聊天指定分类。\n\n<!-- nicole-library:${encoded} -->`;
  const url=new URL('https://github.com/Nicole8206929/study-materials-originals/releases/new');
  url.searchParams.set('tag',batch);url.searchParams.set('title',title||`${category}资料入库`);url.searchParams.set('body',body);
  return {batch,spec,url:url.href};
}

export function validateUploadStatus(value,batch) {
  if (value?.version!==1 || value.batch!==batch || !batchPattern.test(batch) ||
      !['processing','publishing','ready','failed'].includes(value.stage) ||
      !/^[a-z][a-z0-9-]*$/.test(value.cat||'') || !Number.isInteger(value.sourceCount) ||
      value.sourceCount<0 || value.sourceCount>1000 || !Array.isArray(value.bookIds) || value.bookIds.length>1000 ||
      (value.cats!==undefined&&(!Array.isArray(value.cats)||!value.cats.length||value.cats[0]!==value.cat||value.cats.some(id=>typeof id!=='string'||!/^[a-z][a-z0-9-]*$/.test(id)))) ||
      value.bookIds.some(id=>!/^[-a-zA-Z0-9_]+$/.test(id)) ||
      (value.stage==='ready' && !value.bookIds.length)) throw new Error('处理记录不完整，请打开 GitHub 处理记录核实。');
  return value;
}
