// 把原型打包成一个可以直接双击打开的单文件：prototype/standalone.html
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'prototype/index.html'), 'utf8');
const core = readFileSync(join(root, 'src/wishpool.js'), 'utf8').replace(/^export /gm, '');
const app = readFileSync(join(root, 'prototype/app.js'), 'utf8').replace(/^import .*?;\n/m, '');
const tag = '<script type="module" src="./app.js"></script>';
if (!html.includes(tag)) throw new Error('index.html 中找不到 app.js 引用');
const out = html.replace(tag, () => `<script type="module">\n${core}\n${app}\n</script>`);
writeFileSync(join(root, 'prototype/standalone.html'), out);
console.log('已生成 prototype/standalone.html');
