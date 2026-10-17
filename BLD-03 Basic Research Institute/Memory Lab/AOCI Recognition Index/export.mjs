#!/usr/bin/env node
/**
 * Export 层 —— 标准阅读理解包。
 *
 * 下游产品（Soul Forge、笔记、检索、问答）只消费这个包，不重新发明入账逻辑。
 * 包内含三类资产：AOCI 正式资产、片段索引、主张↔原文映射。
 */

const runesOf = (s) => Array.from(s);

/**
 * @param {object}   input
 * @param {string}   input.sourceId   来源 ID
 * @param {string}   input.sha256     原文哈希（后验可核对）
 * @param {string}   input.text       原文
 * @param {Array}    input.segments   segment() 的完整输出（含 text）
 * @param {Array}    input.accepted   admit() 后 status==='accepted' 的条目
 */
export function buildPackage({ sourceId, sha256, text, segments, accepted }) {
  return {
    version: 'reading-package/v1',
    source: {
      sourceId,
      sha256,
      runes: runesOf(text).length,
      segmentCount: segments.length,
    },
    // 片段索引：只放坐标（正文按需回原文档取，不冗余存储）
    segmentIndex: segments.map((s) => ({ index: s.index, offset: s.offset, length: s.length })),
    // AOCI 正式资产：已入账的 FRAS 条目
    aoci: accepted.map((a) => ({ object: a.object, tag: a.tag, entry: a.entry })),
    // 主张↔原文映射：每条主张带锚点 + 精确复现的原文摘录
    claims: accepted.map((a) => ({
      object: a.object,
      anchor: a.anchor,
      excerpt: a.excerpt,
    })),
  };
}

/**
 * 校验包的可复核性：
 *   1) 段按序拼回 = 原文（不丢段、不乱序）
 *   2) 每条主张的锚点能在原文精确复现（定位校验）
 */
export function verifyPackage(pkg, text, segments) {
  const problems = [];

  const joined = segments.map((s) => s.text).join('');
  if (joined !== text) problems.push('reassemble: segments do not reproduce the original text');

  for (const c of pkg.claims) {
    const { offset, length } = c.anchor;
    const actual = runesOf(text).slice(offset, offset + length).join('');
    if (actual !== c.excerpt) {
      problems.push(`claim:${c.object} anchor does not reproduce exactly (offset=${offset}, length=${length})`);
    }
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
