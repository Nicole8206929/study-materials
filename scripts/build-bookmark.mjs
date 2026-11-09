import {build} from 'esbuild';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  entryPoints: [root + 'tools/bookmark-entry.mjs'], bundle: true, minify: true,
  format: 'iife', target: ['chrome100', 'firefox115', 'safari15.6'],
  legalComments: 'inline', write: false,
});
const source = result.outputFiles[0].text.trim();
// Percent encoding prevents the URL parser from treating a # in a CSS
// selector as a fragment or changing Unicode, quotes and whitespace.
const url = 'javascript:' + encodeURIComponent(source + ';void 0');
const output = root + 'tools/github-upload-bookmark.txt';
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== url + '\n') throw new Error('Run npm run build:bookmark and commit the generated bookmark.');
} else {
  await writeFile(output, url + '\n');
}
console.log(`Bookmark ready (${url.length} characters, no external loader).`);
