import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createFileHasher} from '../tools/bookmark-entry.mjs';

test('bookmark hashes in bounded slices, matches SHA256 and caches the selected File', async () => {
  const data = Buffer.alloc(2 * 1024 * 1024 + 17, 0x71);
  let reads = 0;
  const file = {size: data.length, slice(start, end) {
    assert(end - start <= 256 * 1024);
    reads++;
    return new Blob([data.subarray(start, end)]);
  }};
  const hash = createFileHasher();
  const expected = 'sha256:' + createHash('sha256').update(data).digest('hex');
  assert.equal(await hash(file), expected);
  assert.equal(reads, 9);
  assert.equal(await hash(file), expected);
  assert.equal(reads, 9);
});

test('unreadable phone file can be selected and hashed again', async () => {
  let fail = true;
  const file = {size: 3, slice() { return {async arrayBuffer() {
    if (fail) { fail = false; throw new Error('phone file unavailable'); }
    return new TextEncoder().encode('abc').buffer;
  }}; }};
  const hash = createFileHasher();
  await assert.rejects(hash(file), /unavailable/);
  assert.equal(await hash(file), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
