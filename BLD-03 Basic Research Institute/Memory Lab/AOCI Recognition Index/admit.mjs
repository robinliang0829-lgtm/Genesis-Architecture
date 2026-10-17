#!/usr/bin/env node
/**
 * AOCI Admission 层 —— 长文本阅读理解引擎的「入账闸门」。
 *
 * 职责（通用，不依赖任何前端/产品）：
 *   输入：候选 Entry[] + 原文片段锚点
 *   输出：accepted / rejected + 机器可读原因
 *
 * 校验顺序（全部本地完成，先于 AOCI 提交，避免盲目烧机器拒绝）：
 *   1) 结构  object[tag]: F:.. | R:.. | A:.. | S:..
 *   2) 标签  A/B 必须在 Meta 词典，C∈1..9，E∈{L,M,S,T}
 *   3) 长度  F≤160 runes, R≤360 runes/8 项, A≤400 runes/6 项
 *   4) S 配额（runes 按 C 档 + token 上限，1 token=UTF-8 字节/3）
 *   5) 锚点  每条主张必须带 (sourceId,offset,length) 且能按坐标复现
 *
 * 退回策略（「不盲目重烧」核心）：
 *   - 结构/标签/预算 → machine-fixable（本地修，不重烧模型）
 *   - 语义 → model-rewrite（有限次，默认 1 次），仍失败则 rejected
 *   - 绝不静默重试
 */

// ---- 标签词典（官方 starter，来自 aoci.meta.txt）----
const CODE_TAG_DICT = {
  A: new Set('C E A D K M P I R L F O T S X Z'.split(' ')),
  B: new Set('G U B D I N M S C O R P W A H L V Q E Z'.split(' ')),
  C: new Set('1 2 3 4 5 6 7 8 9'.split(' ')),
  E: new Set('L M S T'.split(' ')),
};

// ---- FRAS 硬限制（machine-contract）----
const LIMITS = {
  F: { runes: 160 },
  R: { runes: 360, items: 8 },
  A: { runes: 400, items: 6 },
};

// S 配额：runes 上限（按 C 档）+ token 上限（1 token = UTF-8 字节 / 3）
const S_QUOTA = {
  runes:  { '9': 600, '8': 600, '7': 200, '6': 200, '5': 200, '4': 200, '3': 50, '2': 50, '1': 50 },
  tokens: { '9': 200, '8': 140, '7': 80,  '6': 80,  '5': 80,  '4': 40,  '3': 40, '2': 40, '1': 40 },
};

const encoder = new TextEncoder();
const runes  = (s) => Array.from(s ?? '').length;                 // AOCI 的 rune 口径（code point）
const tokens = (s) => Math.ceil(encoder.encode(s ?? '').length / 3);

// ---- 1) 结构解析 ----
function parseEntry(line) {
  const m = /^(.+?)\[([^\]]+)\]:\s*F:(.*?)\s*\|\s*R:(.*?)\s*\|\s*A:(.*?)\s*\|\s*S:(.*?)\s*$/.exec(line);
  if (!m) return { ok: false, error: 'structure: expect object[tag]: F:.. | R:.. | A:.. | S:..' };
  return { ok: true, object: m[1], tag: m[2], F: m[3].trim(), R: m[4].trim(), A: m[5].trim(), S: m[6].trim() };
}

// ---- 2) 标签校验（compact A+B+C+[D]+E）----
function validateTag(tag) {
  const m = /^([A-Z])([A-Z])([1-9])(-?)([LMST])$/.exec(tag);
  if (!m) return { ok: false, error: `tag: bad shape '${tag}' (expect A+B+C+[D]+E)` };
  const [, a, b, c, d, e] = m;
  if (!CODE_TAG_DICT.A.has(a)) return { ok: false, error: `tag: A '${a}' not in dictionary (${[...CODE_TAG_DICT.A].join('')})` };
  if (!CODE_TAG_DICT.B.has(b)) return { ok: false, error: `tag: B '${b}' not in dictionary (${[...CODE_TAG_DICT.B].join('')})` };
  return { ok: true, A: a, B: b, C: c, D: d, E: e };
}

// ---- 3+4) 长度 + S 配额 ----
function validateLimits(e, tag) {
  const c = tag.C;
  const find = [];
  if (runes(e.F) > LIMITS.F.runes) find.push(`F:${runes(e.F)}>${LIMITS.F.runes} runes`);
  if (runes(e.R) > LIMITS.R.runes) find.push(`R:${runes(e.R)}>${LIMITS.R.runes} runes`);
  if (e.R !== '-' && e.R.split(',').length > LIMITS.R.items) find.push(`R:${e.R.split(',').length}>${LIMITS.R.items} items`);
  if (runes(e.A) > LIMITS.A.runes) find.push(`A:${runes(e.A)}>${LIMITS.A.runes} runes`);
  if (e.A !== '-' && e.A.split(',').length > LIMITS.A.items) find.push(`A:${e.A.split(',').length}>${LIMITS.A.items} items`);
  if (e.S !== '-') {
    if (runes(e.S) > S_QUOTA.runes[c]) find.push(`S:${runes(e.S)}>${S_QUOTA.runes[c]} runes (C${c})`);
    if (tokens(e.S) > S_QUOTA.tokens[c]) find.push(`S:${tokens(e.S)}>${S_QUOTA.tokens[c]} tokens (C${c})`);
  }
  return find;
}

// ---- 5) 锚点校验 ----
// anchor: { sourceId, offset, length }；segments: sourceId -> 原文
function validateAnchor(anchor, segments) {
  if (!anchor) return { ok: false, error: 'anchor: missing (缺引用/无锚点)' };
  const { sourceId, offset, length } = anchor;
  const text = segments?.[sourceId];
  if (text === undefined) return { ok: false, error: `anchor: unknown sourceId '${sourceId}'` };
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length <= 0 || offset + length > runes(text)) {
    return { ok: false, error: `anchor: out of range offset=${offset} length=${length} (doc=${runes(text)} runes)` };
  }
  return { ok: true, excerpt: Array.from(text).slice(offset, offset + length).join('') };
}

// ---- 主入口 ----
// candidates: [{ entry: 'obj[tag]: F:.. | R:.. | A:.. | S:..', anchor?: {sourceId,offset,length} }]
// segments: { sourceId: 原文 }
export function admit(candidates, segments = {}) {
  const out = [];
  for (const c of candidates) {
    const p = parseEntry(c.entry);
    if (!p.ok) { out.push({ status: 'rejected', repair: 'machine', reason: p.error }); continue; }
    const t = validateTag(p.tag);
    if (!t.ok) { out.push({ status: 'rejected', repair: 'machine', object: p.object, reason: t.error }); continue; }
    const lim = validateLimits(p, t);
    if (lim.length) { out.push({ status: 'rejected', repair: 'machine', object: p.object, reason: lim.join('; ') }); continue; }
    const a = validateAnchor(c.anchor, segments);
    if (!a.ok) { out.push({ status: 'rejected', repair: 'machine', object: p.object, reason: a.error }); continue; }
    out.push({ status: 'accepted', object: p.object, tag: p.tag, entry: c.entry, anchor: c.anchor, excerpt: a.excerpt });
  }
  return out;
}

// AOCI 提交占位：复用已跑通的 aoci_update_entry 流程（对象=段文件，code:<path>）。
// 语义退回：model-rewrite 由宿主在拿到 rejected(reason) 后触发，默认至多 1 次。
