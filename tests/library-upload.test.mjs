import test from 'node:test';
import assert from 'node:assert/strict';
import {makeUploadRelease, validateUploadStatus} from '../tools/library-upload.mjs';

test('selected category and tags travel to a new private upload, without a token or draft instruction', () => {
  const batch=makeUploadRelease({cat:'high-school-physics',tags:'深中高中物理资料，复习',mode:'merge',title:'物理合集',expectedCount:'97'},
    [{id:'high-school-physics',name:'高中物理'}],{stamp:'20261110123456',random:'1234abcd'});
  const url=new URL(batch.url);
  assert.equal(url.origin,'https://github.com');
  assert.equal(url.pathname,'/Nicole8206929/study-materials-originals/releases/new');
  assert.equal(url.searchParams.get('tag'),'upload-20261110123456-1234abcd');
  assert(url.searchParams.get('body').includes('"cat":"high-school-physics"'));
  assert(url.searchParams.get('body').includes('Publish release'));
  assert.deepEqual(batch.spec.tags,['深中高中物理资料','复习']);
  assert.throws(()=>makeUploadRelease({cat:'wrong'},[{id:'high-school-physics'}]));
});

test('only a matching confirmed result can clear an upload from the pending list', () => {
  const batch='upload-20261110123456-1234abcd';
  const ready={version:1,batch,stage:'ready',cat:'high-school-physics',sourceCount:97,bookIds:['upload-99'],message:'已入库'};
  assert.equal(validateUploadStatus(ready,batch).stage,'ready');
  assert.throws(()=>validateUploadStatus({...ready,batch:'upload-other'},batch));
  assert.throws(()=>validateUploadStatus({...ready,stage:'done'},batch));
  assert.throws(()=>validateUploadStatus({...ready,bookIds:['javascript:alert(1)']},batch));
});

test('university mathematics child category is carried into the private upload metadata',()=>{
  const result=makeUploadRelease({cat:'university-math',subcat:'analysis',tags:'实分析',mode:'individual'},
    [{id:'university-math',name:'大学数学'}],{stamp:'20261110123456',random:'1234abcd'});
  assert.equal(result.spec.subcat,'analysis');
  assert(new URL(result.url).searchParams.get('body').includes('"subcat":"analysis"'));
});

test('one upload can target several subjects and several university-math branches',()=>{
  const result=makeUploadRelease({cats:['high-school-physics','university-math','high-school-physics'],
    subcats:['analysis','algebra'],tags:'跨学科',mode:'individual'},
    [{id:'high-school-physics',name:'高中物理'},{id:'university-math',name:'大学数学'}],
    {stamp:'20261110123456',random:'1234abcd'});
  assert.deepEqual(result.spec.cats,['high-school-physics','university-math']);
  assert.deepEqual(result.spec.subcats,['analysis','algebra']);
  assert.equal(result.spec.cat,'high-school-physics');
  assert(new URL(result.url).searchParams.get('body').includes('高中物理、大学数学'));
  assert.throws(()=>makeUploadRelease({cats:[],mode:'individual'},[{id:'high-school-physics'}]));
  assert.throws(()=>makeUploadRelease({cats:['high-school-physics'],subcats:['analysis'],mode:'individual'},[{id:'high-school-physics'}]));
});
