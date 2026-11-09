import test from 'node:test';
import assert from 'node:assert/strict';
import {FileSelection} from '../tools/file-selection.mjs';

const file = (name, text = name) => new File([text], name, {lastModified: 1234567});

test('50 files plus 47 append to 97; per-file remove and undo preserve the collection', () => {
  const queue = new FileSelection();
  const all = Array.from({length:97}, (_,index) => file(`${index+1}.pptx`));
  queue.add(all.slice(0,50)); queue.add(all.slice(50));
  assert.equal(queue.files.length,97);
  const removed = queue.entries[12];
  queue.remove(removed.id);
  assert.equal(queue.files.length,96); assert(!queue.files.includes(all[12]));
  queue.undo();
  assert.deepEqual(queue.files,all);
  queue.clear(); assert.equal(queue.files.length,0);
  queue.undo(); assert.deepEqual(queue.files,all);
});

test('reselecting a metadata match uses the new File for content verification; capacity failure preserves previous selection', () => {
  const queue = new FileSelection();
  const first = file('same.pdf','abc'), changed = file('same.pdf','xyz');
  queue.add([first]); queue.add([changed]);
  assert.deepEqual(queue.files,[changed]);
  const before = queue.files;
  assert.throws(() => queue.add(Array.from({length:1000},(_,index) => file(`${index}.pptx`))), /1000/);
  assert.deepEqual(queue.files,before);
});
