import helper from './github-upload-helper.user.js';
import {createFileHasher} from './file-hash.mjs';
export {createFileHasher} from './file-hash.mjs';

if (typeof window !== 'undefined') {
  if (!helper.allowedPage(new URL(location.href))) {
    alert('请先打开 GitHub 私有资料库的“书籍上传区”编辑页，再运行“自动补传”书签。');
  } else if (!location.pathname.includes('/releases/edit/')) {
    alert('先点“书籍上传区”旁的编辑按钮，进入能添加附件的页面，再运行“自动补传”书签。');
  } else {
    helper.install({hash: createFileHasher()});
  }
}
