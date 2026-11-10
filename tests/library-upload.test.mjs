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
