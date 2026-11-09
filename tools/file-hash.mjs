import {sha256} from '@noble/hashes/sha2.js';

export function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('已取消', 'AbortError');
}

// Read bounded slices so a large presentation is never copied into one giant
// ArrayBuffer on a phone. Cache only this page's selected File objects.
export function createFileHasher({signal, onBytes} = {}) {
  const hashes = new WeakMap();
  return async file => {
    if (hashes.has(file)) return hashes.get(file);
    const work = (async () => {
      const state = sha256.create();
      let lastYield = performance.now();
      for (let offset = 0; offset < file.size; offset += 256 * 1024) {
        checkAbort(signal);
        const bytes = new Uint8Array(await file.slice(offset, offset + 256 * 1024).arrayBuffer());
        checkAbort(signal);
        if (bytes.length !== Math.min(256 * 1024, file.size - offset)) throw new Error('文件未完整读出。');
        state.update(bytes);
        onBytes?.(file, Math.min(offset + bytes.length, file.size));
        if (performance.now() - lastYield > 40) {
          await new Promise(resolve => setTimeout(resolve, 0));
          lastYield = performance.now();
        }
      }
      checkAbort(signal);
      return 'sha256:' + Array.from(state.digest(), value => value.toString(16).padStart(2, '0')).join('');
    })();
    hashes.set(file, work);
    try { return await work; }
    catch (error) { hashes.delete(file); throw error; }
  };
}
