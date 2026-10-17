#!/usr/bin/env node
/**
 * Ingest 层 —— 文件/对话 → 统一文档模型。
 *
 * 统一文档模型：{ docId, sourceType, participants, text, sha256, runes }
 * 主路径是「文档本身」，不是分享链接抓取。
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const encoder = new TextEncoder();
const runesOf = (s) => Array.from(s);

/** 原文 SHA-256，后验可核对。 */
export function sha256(text) {
  return createHash('sha256').update(encoder.encode(text)).digest('hex');
}

/** 纯文本 / Markdown。 */
export function fromText({ sourceId, text, sourceType = 'text' }) {
  return {
    docId: sourceId,
    sourceType,
    participants: [],
    text,
    sha256: sha256(text),
    runes: runesOf(text).length,
  };
}

/** 本地文件（10MB~几十 MB 级；按扩展名猜类型）。 */
export function fromFile({ sourceId, path, sourceType }) {
  const text = readFileSync(path, 'utf8');
  const type = sourceType ?? (/\\.md$/i.test(path) ? 'markdown' : 'text');
  return fromText({ sourceId, text, sourceType: type });
}

/** 双方/多方对话：turns = [{ speaker, content }]，按序拼接、保留说话人。 */
export function fromDialogue({ sourceId, turns, sourceType = 'dialogue' }) {
  const participants = [...new Set(turns.map((t) => t.speaker))];
  const text = turns.map((t) => `${t.speaker}: ${t.content}`).join('\n');
  return { ...fromText({ sourceId, text, sourceType }), participants };
}
