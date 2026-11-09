import {build} from 'esbuild';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({entryPoints:[root+'tools/upload-checker-entry.mjs'], bundle:true,
  minify:true, format:'iife', target:['chrome90','firefox115','safari15.6'], legalComments:'inline', write:false});
const output = root + 'assets/upload-checker.js', source = result.outputFiles[0].text;
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== source) throw new Error('Run npm run build:checker and commit the generated checker.');
} else await writeFile(output, source);
console.log('Local checker bundle ready.');
