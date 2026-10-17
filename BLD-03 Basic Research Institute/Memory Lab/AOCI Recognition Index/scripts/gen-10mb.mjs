#!/usr/bin/env node
/**
 * 生成 ~10MB 合成对话 → 切段 → 写段文件到 E:\corpus\doc-10mb\
 * 段长（maxRunes）作为第一个命令行参数传入，默认 4000。
 *
 * 运行：
 *   node gen-10mb.mjs [maxRunes]
 */

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { segment } from '../segment.mjs';

const TARGET_BYTES = 10 * 1024 * 1024; // 10 MiB
const maxRunes = Number(process.argv[2] ?? 4000);
const BASE = 'user: 我在记录窗台薄荷每天的变化，想找一个能一起观察、也会说明不确定之处的方式。\n' +
             'assistant: 我会把观察整理成可回看的记录，并在没有依据时明确说不知道。\n';

const n = Math.ceil(TARGET_BYTES / Buffer.byteLength(BASE, 'utf8'));
const text = BASE.repeat(n);

const segments = segment({ sourceId: 'doc-10mb', text, maxRunes });

// 先清空旧段文件，避免残留旧数量的文件
const dir = 'E:\\OpenAstra-Soul-Forge-Engine\\corpus\\doc-10mb';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
for (const s of segments) {
  writeFileSync(`${dir}\\seg-${String(s.index).padStart(4, '0')}.txt`, s.text, 'utf8');
}

const index = segments.map((s) => ({ index: s.index, offset: s.offset, length: s.length }));
const indexPath = 'C:\\Users\\Administrator\\.dsh\\bot\\workspace\\longtext-engine\\segment-index-10mb.json';
writeFileSync(indexPath, JSON.stringify({
  sourceId: 'doc-10mb',
  maxRunes,
  totalBytes: Buffer.byteLength(text, 'utf8'),
  totalRunes: Array.from(text).length,
  segmentCount: segments.length,
  segments: index,
}, null, 2));

console.log(`maxRunes=${maxRunes} bytes=${Buffer.byteLength(text, 'utf8')} runes=${Array.from(text).length} segments=${segments.length}`);
console.log(`index -> ${indexPath}`);
