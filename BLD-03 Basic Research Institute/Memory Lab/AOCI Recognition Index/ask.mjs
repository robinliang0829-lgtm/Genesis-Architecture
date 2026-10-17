#!/usr/bin/env node
/**
 * Ask 层 —— 基于包的有据问答。
 *
 * 铁律：只根据已读材料回答；每个答案附证据定位；没有证据就说没有。
 * 不重读原文，只查 Export 出来的包。
 */

/** 关键词检索（零依赖，通用）；返回按命中度排序的主张。 */
export function search(pkg, query) {
  const terms = query.split(/\s+/).filter(Boolean);
  return pkg.claims
    .map((c) => ({
      ...c,
      score: terms.length === 0 ? 1 : terms.reduce((n, t) => n + (c.excerpt.includes(t) ? 1 : 0), 0),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** 回答契约：模型基于命中的主张作答，只引用证据；无命中则明说没有证据。 */
export function answer(pkg, query, hits) {
  if (!hits || hits.length === 0) {
    return { answer: '没有证据：已读材料里没有相关内容。', evidence: [] };
  }
  return {
    answer: '<模型基于命中的主张作答，只引用证据>',
    evidence: hits.map((h) => ({ object: h.object, excerpt: h.excerpt, anchor: h.anchor })),
  };
}
