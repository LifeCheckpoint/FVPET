/**
 * 节点卡片摘要投影：把 IrNode 收敛为紧凑两行（主 + 次）。
 * 纯函数、无 React，便于 headless 测试。
 */

import type { IrNode } from '@hcb-editor/hcb/ir';
import { renderCond } from '@hcb-editor/editor';
import { nodeKindLabel } from '../theme/meta.js';

export interface NodeSummary {
  /** 主行：节点最关键的语义内容。 */
  readonly primary: string;
  /** 次行：种类标签或补充信息。 */
  readonly secondary: string;
}

const MAX_LINE = 26;

function truncate(text: string): string {
  if (text.length <= MAX_LINE) {
    return text;
  }
  return `${text.slice(0, MAX_LINE - 1)}…`;
}

export function summarizeNode(node: IrNode): NodeSummary {
  switch (node.kind) {
    case 'speak':
      return { primary: node.speaker || '？？？', secondary: truncate(node.text) || '　' };
    case 'dia':
      return { primary: truncate(node.text) || '　', secondary: nodeKindLabel('dia') };
    case 'label':
      return { primary: node.name, secondary: nodeKindLabel('label') };
    case 'bgset':
      return { primary: node.background, secondary: nodeKindLabel('bgset') };
    case 'cgset':
      return { primary: node.name, secondary: nodeKindLabel('cgset') };
    case 'bsset':
      return { primary: node.character, secondary: nodeKindLabel('bsset') };
    case 'selset':
      return { primary: `${node.choices.length} 个选项`, secondary: nodeKindLabel('selset') };
    case 'audio':
      return { primary: `${node.type} ${node.channelOrNum}`, secondary: nodeKindLabel('audio') };
    case 'branch':
      return { primary: renderCond(node.cond), secondary: nodeKindLabel('branch') };
    case 'thread':
      return { primary: `slot ${node.slot}`, secondary: nodeKindLabel('thread') };
    case 'jump':
      return { primary: node.target || '？', secondary: nodeKindLabel('jump') };
    case 'wait':
      return { primary: `${node.ms} ms`, secondary: nodeKindLabel('wait') };
    case 'msgset':
      return { primary: node.position, secondary: nodeKindLabel('msgset') };
    case 'eyecatch':
      return { primary: 'eyecatch', secondary: nodeKindLabel('eyecatch') };
    case 'bsfade':
      return { primary: 'bsfade', secondary: nodeKindLabel('bsfade') };
    case 'white':
      return { primary: 'white', secondary: nodeKindLabel('white') };
    case 'raw':
      return { primary: `${node.bytes.byteLength} 字节`, secondary: nodeKindLabel('raw') };
    case 'comment':
      return { primary: truncate(node.text) || '　', secondary: nodeKindLabel('comment') };
  }
}
