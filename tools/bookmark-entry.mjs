import {sha256} from '@noble/hashes/sha2.js';
import helper from './github-upload-helper.user.js';

// Read bounded slices so a large presentation is never copied into one giant
// ArrayBuffer on a phone. Cache only this page's selected File objects.
export function createFileHasher() {
  const hashes = new WeakMap();
  return async file => {
    if (hashes.has(file)) return hashes.get(file);
    const work = (async () => {
      const state = sha256.create();
      let lastYield = performance.now();
      for (let offset = 0; offset < file.size; offset += 256 * 1024) {
        state.update(new Uint8Array(await file.slice(offset, offset + 256 * 1024).arrayBuffer()));
        if (performance.now() - lastYield > 40) {
          await new Promise(resolve => setTimeout(resolve, 0));
          lastYield = performance.now();
        }
      }
      return 'sha256:' + Array.from(state.digest(), value => value.toString(16).padStart(2, '0')).join('');
    })();
    hashes.set(file, work);
    try { return await work; }
    catch (error) { hashes.delete(file); throw error; }
  };
}

if (typeof window !== 'undefined') {
  if (!helper.allowedPage(new URL(location.href))) {
    alert('请先打开 GitHub 私有资料库的“书籍上传区”编辑页，再运行“自动补传”书签。');
  } else if (!location.pathname.includes('/releases/edit/')) {
    alert('先点“书籍上传区”旁的编辑按钮，进入能添加附件的页面，再运行“自动补传”书签。');
  } else {
    helper.install({hash: createFileHasher()});
  }
}
