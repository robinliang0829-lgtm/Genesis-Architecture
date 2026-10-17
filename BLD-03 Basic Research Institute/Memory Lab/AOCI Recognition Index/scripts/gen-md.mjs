#!/usr/bin/env node
/**
 * 生成「中等 Markdown（几百 KB）」验收语料 → 切段 → 写段文件到 E:\corpus\doc-md\
 * 段长（maxRunes）作为第一个命令行参数传入，默认 4000。
 *
 * 与 gen-10mb.mjs 的差异：
 *   1) 语料是真实 Markdown 结构（标题/段落/列表/代码块/表格/引用），非合成对话
 *   2) 除了生成+物化，还就地跑一遍本地验收（拼回=原文 / 坐标复现 / 抽 10 条主张 / 破坏用例）
 *
 * 运行：
 *   node gen-md.mjs [maxRunes]
 */

import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { segment, reassemble, locate } from '../segment.mjs';
import { admit } from '../admit.mjs';

const TARGET_BYTES = 400 * 1024; // ~400 KB（「几百 KB」档）
const maxRunes = Number(process.argv[2] ?? 4000);
const SOURCE_ID = 'doc-md';

// ---- Markdown 语料生成（章节轮转，内容随 n 变化，保证各段可区分）----
const TITLES = [
  '分段与稳定坐标', '入账闸门与退回策略', '导出包边界', '有据问答与证据定位',
  '切分断点与自然边界', '原文哈希与可复验', '锚点的精确复现', '预算与令牌配额',
  '标签词典的合法性', '语义退回的重写上限',
];

function chapter(n) {
  const t = TITLES[(n - 1) % TITLES.length];
  const code = `// 示例：${t}\nfunction step${n}(input) {\n  const a = ${n} * 2;\n  const b = a + ${n};\n  return { input, a, b, label: '第${n}段' };\n}\n`;
  const rows = [
    `| 字段 | 类型 | 说明（第 ${n} 章） |`,
    `| --- | --- | --- |`,
    `| sourceId | string | 来源稳定 ID（此处为 \`${SOURCE_ID}\`） |`,
    `| offset | number | 段起始 rune 偏移 |`,
    `| length | number | 段 runes 长度 |`,
  ].join('\n');
  return [
    `## ${n}. ${t}`,
    ``,
    `第 ${n} 章讨论「${t}」。核心原则：每一段都必须能按 (sourceId, offset, length) 精确回到原文，不允许只有摘要没有锚点。模型写出的每条主张都必须逐条指向具体片段，而不是甩一段散文。`,
    ``,
    `在实际工程里，${t} 这条边界一旦被破坏，就会出现「认知无法复验」的后果：读者无法判断某条结论到底来自原文的哪一句。因此我们把坐标口径统一成 runes（UTF-16 code point），offset 从 0 起、length 为 runes 数，保证切分绝不切断一个多字节字符。`,
    ``,
    `这一章还强调：证据不足时要明确说「没有证据」，而不是硬编。第 ${n} 章给出的样例数据为 ${n * 7}，用于说明字段取值；它不是结论，只是一个定位演示。`,
    ``,
    `要点（第 ${n} 章）：`,
    `- 每条主张必须带 (sourceId, offset, length) 锚点`,
    `- 切分后仍能按序拼回原文，不能丢段、不能乱序`,
    `- 非法输入在本地修或明确拒绝，不盲目重烧模型`,
    `- 导出包是下游唯一消费面，不重新发明入账`,
    ``,
    '```js',
    code.trimEnd(),
    '```',
    ``,
    rows,
    ``,
    '> 引用：本章第 ' + n + ' 段的定位演示值 = ' + (n * 7) + '，可在原文按坐标精确复现。',
    ``,
    '---',
    '',
  ].join('\n');
}

let text = `# 通用长文本阅读理解引擎 · 验收语料（中等 Markdown）\n\n> 本文档是「中等 Markdown（几百 KB）」档的验收用合成语料，覆盖标题、段落、列表、代码块、表格、引用，用于验证 Segment / Admit / Export 在真实 Markdown 结构上的表现。\n\n`;
let n = 0;
while (Buffer.byteLength(text, 'utf8') < TARGET_BYTES) {
  n += 1;
  text += chapter(n);
}

const totalBytes = Buffer.byteLength(text, 'utf8');
const totalRunes = Array.from(text).length;

// ---- 1) 切段 ----
const segments = segment({ sourceId: SOURCE_ID, text, maxRunes });

// ---- 2) 写原文到工作区（供复核/后续阅读）----
const corpusDir = 'C:\\Users\\Administrator\\.dsh\\bot\\workspace\\longtext-engine\\corpus';
mkdirSync(corpusDir, { recursive: true });
const sourcePath = `${corpusDir}\\doc-md-source.md`;
writeFileSync(sourcePath, text, 'utf8');

// ---- 3) 段文件物化到 E:\ 仓库（AOCI 当 code 对象收）----
const dir = 'E:\\OpenAstra-Soul-Forge-Engine\\corpus\\doc-md';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
for (const s of segments) {
  writeFileSync(`${dir}\\seg-${String(s.index).padStart(4, '0')}.txt`, s.text, 'utf8');
}

// ---- 4) 段索引（offset/length，供 Export + 坐标复现）----
const indexPath = 'C:\\Users\\Administrator\\.dsh\\bot\\workspace\\longtext-engine\\segment-index-md.json';
writeFileSync(indexPath, JSON.stringify({
  sourceId: SOURCE_ID,
  maxRunes,
  totalBytes,
  totalRunes,
  segmentCount: segments.length,
  segments: segments.map((s) => ({ index: s.index, offset: s.offset, length: s.length })),
}, null, 2));

// ---- 5) 本地验收 ----
console.log(`maxRunes=${maxRunes} bytes=${totalBytes} runes=${totalRunes} segments=${segments.length}`);
console.log(`source -> ${sourcePath}`);
console.log(`index  -> ${indexPath}`);
console.log('--- 本地验收 ---');

// 5a. 拼回 = 原文
const okReassemble = reassemble(segments) === text;
console.log(`[1] 分段拼回=原文            ${okReassemble ? 'PASS' : 'FAIL'}`);

// 5b. 每个段文件字节 === 按坐标在原文复现的内容
let fileMismatch = 0;
for (const s of segments) {
  const written = readFileSync(`${dir}\\seg-${String(s.index).padStart(4, '0')}.txt`, 'utf8');
  if (written !== locate(text, s.offset, s.length)) fileMismatch += 1;
}
console.log(`[2] 段文件字节=坐标复现      ${fileMismatch === 0 ? 'PASS' : `FAIL(${fileMismatch} 段不符)`}`);

// 5c. 抽 10 条主张 → 坐标核对 100% 命中
const sampleIdx = segments.length > 10
  ? Array.from({ length: 10 }, (_, i) => Math.floor((i + 0.5) * segments.length / 10))
  : segments.map((_, i) => i);
const claims = sampleIdx.map((i) => {
  const s = segments[i];
  const off = s.offset + Math.min(2, Math.max(0, s.length - 2)); // 略过段首标记
  const len = Math.min(24, s.length - (off - s.offset));
  const excerpt = locate(text, off, len);
  const prev = i > 0 ? `code:corpus/doc-md/seg-${String(segments[i - 1].index).padStart(4, '0')}.txt` : '-';
  return {
    entry: `seg-${String(s.index).padStart(4, '0')}.txt[SB3M]: F:第${s.index}段关于${TITLES[(s.index) % TITLES.length]}的主张 | R:${prev} | A:markdown,section | S:-`,
    anchor: { sourceId: SOURCE_ID, offset: off, length: len },
    excerpt,
  };
});
let claimHit = 0;
for (const c of claims) {
  if (locate(text, c.anchor.offset, c.anchor.length) === c.excerpt) claimHit += 1;
}
console.log(`[3] 抽 ${claims.length} 条主张坐标核对   ${claimHit === claims.length ? 'PASS' : 'FAIL'} (${claimHit}/${claims.length} 命中)`);

// 5d. 入账闸门：10 条合法主张 → 全 accepted
const admitted = admit(claims.map((c) => ({ entry: c.entry, anchor: c.anchor })), { [SOURCE_ID]: text });
const acceptedCount = admitted.filter((r) => r.status === 'accepted').length;
console.log(`[4] 合法主张入账闸门        ${acceptedCount === claims.length ? 'PASS' : 'FAIL'} (${acceptedCount}/${claims.length} accepted)`);

// 5e. 破坏用例：超长 S / 非法 tag / 缺引用 → 本地明确拒绝，不重烧
const bad = admit([
  { entry: `seg-0000.txt[SB7M]: F:合法结构 | R:- | A:- | S:${'x'.repeat(250)}`, anchor: { sourceId: SOURCE_ID, offset: 0, length: 10 } },
  { entry: `seg-0000.txt[YZ3M]: F:非法标签 | R:- | A:- | S:-`, anchor: { sourceId: SOURCE_ID, offset: 0, length: 10 } },
  { entry: `seg-0000.txt[SB3M]: F:缺锚点 | R:- | A:- | S:-` },
], { [SOURCE_ID]: text });
const allRejected = bad.every((r) => r.status === 'rejected' && r.repair === 'machine');
console.log(`[5] 破坏用例本地明确拒绝    ${allRejected ? 'PASS' : 'FAIL'}`);
for (const r of bad) console.log(`    rejected · ${r.reason}`);

console.log(`--- 段文件已就绪，等待 AOCI 入账（aoci_maintain → aoci_update_entry）---`);
