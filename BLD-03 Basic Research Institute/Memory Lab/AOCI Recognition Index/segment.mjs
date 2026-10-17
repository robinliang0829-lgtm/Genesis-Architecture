#!/usr/bin/env node
/**
 * Segment 层 —— 有界切分 + 稳定坐标。
 *
 * 坐标口径：runes（UTF-16 code point）；offset 0 起、length 为 runes 数。
 * 保证：
 *   - 每段有界（≤ maxRunes），送给模型 / 写入 AOCI 的单份证据不会无限膨胀
 *   - 段按序拼回 = 原文（不乱序、不丢段）
 *   - 绝不切断一个多字节字符（用 code point 切）
 *   - 优先在换行等自然边界断开，避免把一句话从中间切开
 */

const runesOf = (s) => Array.from(s);

/**
 * @param {object}   input
 * @param {string}   input.sourceId  来源 ID（稳定，用于锚点定位）
 * @param {string}   input.text      原文
 * @param {number}   [input.maxRunes=4000]  单段 runes 上限
 * @returns {{sourceId:string,index:number,offset:number,length:number,text:string}[]}
 */
export function segment({ sourceId, text, maxRunes = 4000 }) {
  const chars = runesOf(text);
  const total = chars.length;
  const out = [];
  let start = 0;
  let index = 0;

  while (start < total) {
    let end = Math.min(start + maxRunes, total);
    if (end < total) {
      // 在 (start, end) 内找最后一个换行，作为更自然的断点
      let best = -1;
      for (let i = end - 1; i > start; i--) {
        if (chars[i] === '\n') { best = i + 1; break; }
      }
      // 只接受不会让段过短的断点（至少保留 30% 内容）
      if (best > start + Math.floor(maxRunes * 0.3)) end = best;
    }
    out.push({
      sourceId,
      index,
      offset: start,
      length: end - start,
      text: chars.slice(start, end).join(''),
    });
    start = end;
    index += 1;
  }
  return out;
}

/** 按序拼回原文；用于校验「不丢段、不乱序」。 */
export function reassemble(segments) {
  return segments.map((s) => s.text).join('');
}

/** 定位校验：声称引用的文字必须能按坐标在原文精确复现。 */
export function locate(text, offset, length) {
  return runesOf(text).slice(offset, offset + length).join('');
}
