const test = require('node:test');
const assert = require('node:assert/strict');
const {UploadQueue, StopError, UploadError, FileConflict, allowedPage} = require('../tools/github-upload-helper.user.js');
const file = (name, size = 25) => ({name,size,lastModified:100});
function setup(initial = {}, failures = {}) {
  const remote = new Map(Object.entries(initial).map(([name,size])=>[name,{size}]));
  const calls = {uploads:[], cleanup:[], saves:0, active:0, maxActive:0};
  const adapter = {
    verified:false,
    async refresh() {},
    async inspect(f) { return remote.get(f.name) || null; },
    async upload(f) {
      calls.uploads.push(f.name); calls.active++; calls.maxActive=Math.max(calls.maxActive,calls.active);
      await Promise.resolve(); calls.active--;
      if (failures[f.name]) { failures[f.name]--; throw new UploadError('failed'); }
      remote.set(f.name,{size:f.size});
    },
    async verify(f) { assert.equal(remote.get(f.name).size,f.size); },
    async cleanupFailed(f) { calls.cleanup.push(f.name); },
    async saveDraft() { calls.saves++; return 'saved draft'; }
  };
  const queue = new UploadQueue(adapter,()=>{},async()=>{});
  return {queue,adapter,calls,remote};
}
test('all existing files are skipped without an upload, deletion or save',async()=>{
  const {queue,calls}=setup({'a.pdf':25,'b.pptx':25});
  queue.add([file('a.pdf'),file('b.pptx')]); await queue.run();
  assert.equal(queue.summary().skipped,2); assert.deepEqual(calls.uploads,[]); assert.deepEqual(calls.cleanup,[]); assert.equal(calls.saves,0);
});
test('reselecting all 97 files uploads only missing files and serializes requests',async()=>{
  const all=Array.from({length:97},(_,i)=>file(`${i}.pptx`));
  const {queue,calls}=setup(Object.fromEntries(all.slice(0,81).map(f=>[f.name,f.size])));
  queue.add(all); await queue.run();
  assert.equal(queue.summary().skipped,81); assert.equal(queue.summary().success,16);
  assert.deepEqual(calls.uploads,all.slice(81).map(f=>f.name)); assert.equal(calls.maxActive,1); assert.equal(calls.saves,1);
});
test('same-name different-size remote file is preserved as a conflict',async()=>{
  const {queue,calls,remote}=setup({'a.pdf':40});
  queue.add([file('a.pdf',41),file('b.pdf')]); await queue.run();
  assert.equal(queue.summary().conflict,1); assert.deepEqual(calls.uploads,['b.pdf']);
  assert.equal(remote.get('a.pdf').size,40); assert.equal(calls.saves,0);
});
test('an interrupted upload retries only after clearing its own failed placeholder',async()=>{
  const {queue,calls}=setup({}, {'a.pdf':2});
  queue.add([file('a.pdf')]); await queue.run();
  assert.equal(queue.summary().success,1); assert.equal(calls.uploads.length,3); assert.deepEqual(calls.cleanup,['a.pdf','a.pdf']);
});
test('retry limit leaves failed file retryable and continues other files',async()=>{
  const {queue,calls}=setup({}, {'a.pdf':4});
  queue.add([file('a.pdf'),file('b.pdf')]); await queue.run();
  assert.equal(queue.summary().failed,1); assert.equal(queue.summary().success,1); assert.equal(calls.uploads.filter(f=>f==='a.pdf').length,4);
  await queue.retry(); assert.equal(queue.summary().failed,0); assert.equal(queue.summary().success,2);
});
test('uncertain server state pauses without sending or deleting anything',async()=>{
  const {queue,adapter,calls}=setup(); adapter.inspect=async()=>{throw new StopError('cannot identify');};
  queue.add([file('a.pdf'),file('b.pdf')]); await queue.run();
  assert(queue.paused); assert.deepEqual(calls.uploads,[]); assert.deepEqual(calls.cleanup,[]);
});
test('unconfirmed success pauses rather than uploading the same file again',async()=>{
  const {queue,adapter,calls}=setup(); adapter.verify=async()=>{throw new StopError('pending verification');};
  queue.add([file('a.pdf'),file('b.pdf')]); await queue.run();
  assert(queue.paused); assert.deepEqual(calls.uploads,['a.pdf']); assert.deepEqual(calls.cleanup,[]); assert.equal(calls.saves,0);
});
test('repeated selection while queued does not create duplicate uploads',async()=>{
  const {queue,calls}=setup(); queue.add([file('a.pdf'),file('a.pdf')]); queue.add([file('a.pdf')]);
  await queue.run(); assert.deepEqual(calls.uploads,['a.pdf']);
});
test('a fresh queue rechecks the remote source after page reload',async()=>{
  const first=setup(); first.queue.add([file('a.pdf')]); await first.queue.run();
  const second=setup({'a.pdf':25}); second.queue.add([file('a.pdf'),file('b.pdf')]); await second.queue.run();
  assert.deepEqual(second.calls.uploads,['b.pdf']); assert.equal(second.queue.summary().skipped,1);
});
test('cleanup uncertainty pauses and never deletes a successful file',async()=>{
  const {queue,adapter,calls}=setup({}, {'a.pdf':1});
  adapter.cleanupFailed=async()=>{throw new StopError('no safe remove button');};
  queue.add([file('a.pdf'),file('b.pdf')]); await queue.run();
  assert(queue.paused); assert.deepEqual(calls.uploads,['a.pdf']); assert.equal(calls.saves,0);
});
test('invalid empty or 2-GiB files are not submitted',async()=>{
  const {queue,calls}=setup(); queue.add([file('empty.pdf',0),file('large.pdf',2*1024**3)]); await queue.run();
  assert.equal(queue.summary().failed,2); assert.deepEqual(calls.uploads,[]);
});
test('different repositories and protocols are outside the helper scope',()=>{
  assert(allowedPage(new URL('https://github.com/Nicole8206929/study-materials-originals/releases')));
  for(const url of ['https://github.com/other/repo/releases','http://github.com/Nicole8206929/study-materials-originals/releases','https://github.com/Nicole8206929/study-materials-originals/releases-not-real']) assert(!allowedPage(new URL(url)));
});
