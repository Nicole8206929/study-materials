import {test} from 'node:test';
import assert from 'node:assert/strict';
import {screenActivity} from '../tools/screen-activity.mjs';
const settle = () => new Promise(resolve => setImmediate(resolve));
function lease() {
  const value = new EventTarget(); value.released = false;
  value.release = async () => { value.released = true; value.dispatchEvent(new Event('release')); };
  return value;
}
test('screen lock follows work and foreground visibility, never holds an idle lock', async () => {
  let visible = true; const locks = [], notes = [];
  const activity = screenActivity({request:async () => { const lock = lease(); locks.push(lock); return lock; },visible:() => visible,notify:text => notes.push(text)});
  activity.setActive(true); await settle();
  assert.equal(locks.length,1); assert.equal(locks[0].released,false);
  visible = false; activity.update(); await settle(); assert.equal(locks[0].released,true);
  assert(notes.at(-1).includes('后台'));
  visible = true; activity.update(); await settle(); assert.equal(locks.length,2);
  activity.setActive(false); await settle(); assert(locks.every(lock => lock.released));
});
test('a late lock is released if a task finished while permission was pending', async () => {
  let resolve; const held = lease();
  const activity = screenActivity({request:() => new Promise(done => { resolve = done; }),visible:() => true,notify:() => {}});
  activity.setActive(true); await settle(); activity.setActive(false); resolve(held); await settle();
  assert.equal(held.released,true);
});
test('unsupported and denied wake locks leave processing available', async () => {
  for (const request of [null,async () => { throw new Error('denied'); }]) {
    const notes = [];
    const activity = screenActivity({request,visible:() => true,notify:text => notes.push(text)});
    activity.setActive(true); await settle(); assert(notes.at(-1).includes('前台'));
  }
});
