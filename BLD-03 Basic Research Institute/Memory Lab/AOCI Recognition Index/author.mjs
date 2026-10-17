#!/usr/bin/env node
/**
 * Author 层 —— 起草契约。
 *
 * 本层不实现模型调用：它定义「读段 → 出主张」的输入输出契约，
 * 供任何宿主驱动任何模型。模型（Author 的执行者）读段、写 FRAS Entry，
 * 坐标由段对象天然锚定，不需要模型自己算偏移。
 */

/** 段对象名：corpus/<sourceId>/seg-<index>.txt（写入 AOCI 时的 code 对象）。 */
export function segmentObject(segment) {
  return `seg-${String(segment.index).padStart(4, '0')}.txt`;
}

/** 提示词模板：喂给任意模型，让它读段写 Entry。 */
export function authorPrompt(segment) {
  return [
    '读下面这一段原文，写一条 AOCI FRAS Entry。',
    '格式：object[tag]: F:.. | R:.. | A:.. | S:..',
    '  - tag 用 compact A+B+C+[D]+E，字母必须来自 Meta 词典，不造字母',
    '  - F 写这段的核心主张（≤160 runes）',
    '  - R 写与其它段的强关系（code:seg-….txt，无则 -）',
    '  - A 写属性（参与者/话题等，≤400 runes）',
    '  - S 只写非推断、防出错的约束，没有就 S:-',
    `段对象名：${segmentObject(segment)}`,
    `段坐标：sourceId=${segment.sourceId} offset=${segment.offset} length=${segment.length}`,
    '',
    '原文：',
    segment.text,
  ].join('\n');
}

/** 把模型产出的 entry 绑上段的稳定坐标，形成「主张」。 */
export function makeClaim(segment, entry) {
  return {
    entry,
    anchor: { sourceId: segment.sourceId, offset: segment.offset, length: segment.length },
  };
}
