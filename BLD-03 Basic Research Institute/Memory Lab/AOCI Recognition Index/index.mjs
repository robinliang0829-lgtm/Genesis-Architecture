#!/usr/bin/env node
/**
 * 长文本阅读理解引擎 —— 六模块总装。
 *
 * 流水线：Ingest → Segment → Author → Admit → Export → Ask
 *
 * 用法：
 *   const doc   = fromDialogue({ sourceId, turns });          // 1 输入
 *   const segs  = segment(doc);                                // 2 切分
 *   const claim = makeClaim(segs[0], '<模型写的 entry>');      // 3 起草（模型执行）
 *   const res   = admit([claim], { [doc.docId]: doc.text });   // 4 入账
 *   const pkg   = buildPackage({ ...doc, segments: segs, accepted: res.filter(r => r.status === 'accepted') });
 *   const ans   = answer(pkg, q, search(pkg, q));              // 6 问答
 */

export {
  fromText,
  fromFile,
  fromDialogue,
  sha256,
} from './ingest.mjs';

export {
  segment,
  reassemble,
  locate,
} from './segment.mjs';

export {
  segmentObject,
  authorPrompt,
  makeClaim,
} from './author.mjs';

export {
  admit,
} from './admit.mjs';

export {
  buildPackage,
  verifyPackage,
} from './export.mjs';

export {
  search,
  answer,
} from './ask.mjs';
