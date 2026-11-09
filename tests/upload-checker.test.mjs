import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, createCipheriv, randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {planFiles, createUploadZip, decryptSnapshot} from '../tools/upload-checker-core.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const file = (name, text) => new File([text], name, {lastModified: 1794182400000});
const snapshot = (files = []) => ({version: 1, checkedAt: '2026-11-09T10:00:00Z', expectedCount: 97,
  uploaded: files.map(([text]) => ({size: Buffer.byteLength(text), sha256: digest(text)}))});

test('select all 97 originals: content-match 81 successful uploads and retain only 16 missing files', async () => {
  const originals = Array.from({length: 97}, (_, i) => file(`${i + 1}.pptx`, `presentation ${i + 1}`));
  const state = snapshot(Array.from({length: 81}, (_, i) => [`presentation ${i + 1}`]));
  const result = await planFiles(originals, state);
  assert.equal(result.rows.filter(row => row.state === 'uploaded').length, 81);
  assert.deepEqual(result.rows.filter(row => row.state === 'missing').map(row => row.file.name),
    Array.from({length: 16}, (_, i) => `${i + 82}.pptx`));
});

test('renamed originals skip by content; same-name same-size changes remain missing; repeated new content packs once', async () => {
  const result = await planFiles([file('renamed.pdf', 'abc'), file('old.pdf', 'xyz'), file('copy.pdf', 'xyz')], snapshot([['abc']]));
  assert.deepEqual(result.rows.map(row => row.state), ['uploaded', 'missing', 'duplicate']);
});

test('bad inventory and invalid phone files never produce a usable missing-file plan', async () => {
  await assert.rejects(planFiles([file('a.pdf', 'abc')], {version: 1, uploaded: [{size: 3, sha256: 'incomplete'}]}));
  const result = await planFiles([file('empty.pdf', ''), file('../escape.pdf', 'abc'), file('archive.zip', 'abc')], snapshot());
  assert(result.rows.every(row => row.state === 'invalid'));
});

test('ZIP opens in Python, preserves original bytes and Chinese filenames, excludes uploaded and repeated contents', async () => {
  const plan = await planFiles([file('旧文件.pdf', 'abc'), file('新课件.pptx', 'xyz'), file('同名.pptx', 'other'),
    file('同名.pptx', 'third'), file('重复.pptx', 'xyz')], snapshot([['abc']]));
  const result = await createUploadZip(plan);
  assert.equal(result.count, 3);
  const listing = JSON.parse(execFileSync('python3', ['-c',
    'import sys,io,json,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode() for n in z.namelist()},ensure_ascii=False))'
  ], {input: Buffer.from(await result.blob.arrayBuffer()), encoding: 'utf8'}));
  assert.deepEqual(listing, {'资料/0001/新课件.pptx':'xyz', '资料/0002/同名.pptx':'other', '资料/0003/同名.pptx':'third'});
  await assert.rejects(createUploadZip({rows:[{file:file('empty.pdf',''),state:'invalid'}]}));
  await assert.rejects(createUploadZip(plan, {maxBytes: 30}));
});

test('private inventory decrypts only with its full private link; wrong keys and tampered data stop checking', async () => {
  const key = randomBytes(32), iv = randomBytes(12), state = snapshot([['private original']]);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final(), cipher.getAuthTag()]);
  const envelope = {version: 1, iv: iv.toString('base64url'), data: data.toString('base64url')};
  assert.deepEqual(await decryptSnapshot(envelope, key.toString('base64url')), state);
  await assert.rejects(decryptSnapshot(envelope, randomBytes(32).toString('base64url')));
  const changed = Buffer.from(data); changed[0] ^= 1;
  await assert.rejects(decryptSnapshot({...envelope, data: changed.toString('base64url')}, key.toString('base64url')));
});

test('cancelling a large phone read stops promptly without returning a partial plan or ZIP', async () => {
  let reads = 0;
  const source = new File([new Uint8Array(3 * 1024 * 1024)], 'large.pptx');
  const phone = {name: source.name, size: source.size, slice(start, end) {
    assert(end - start <= 256 * 1024); reads++; return source.slice(start, end);
  }};
  const check = new AbortController();
  await assert.rejects(planFiles([phone], snapshot(), {signal: check.signal, progress() { check.abort(); }}), {name: 'AbortError'});
  assert.equal(reads, 1);
  const plan = await planFiles([file('new.pdf', 'xyz')], snapshot());
  const pack = new AbortController(); pack.abort();
  await assert.rejects(createUploadZip(plan, {signal: pack.signal}), {name: 'AbortError'});
});

test('older mobile AbortSignal works and a truncated phone read is never packaged', async () => {
  const signal = new AbortController().signal;
  Object.defineProperty(signal, 'throwIfAborted', {value: undefined});
  const valid = await planFiles([file('a.pdf','abc')], snapshot(), {signal});
  assert.equal(valid.rows[0].state, 'missing');
  const short = {name:'short.pdf',size:3,slice() { return new Blob(['ab']); }};
  const invalid = await planFiles([short], snapshot());
  assert.equal(invalid.rows[0].state, 'invalid');
});
