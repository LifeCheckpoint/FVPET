/**
 * 调色板新建节点的默认字段。
 */

import type { IrNode } from '@hcb-editor/hcb/ir';
import {
  audioNode,
  bgsetNode,
  branchNode,
  bsfadeNode,
  bssetNode,
  cgsetNode,
  commentNode,
  diaNode,
  eyecatchNode,
  jumpNode,
  labelNode,
  msgsetNode,
  selsetNode,
  speakNode,
  threadNode,
  waitNode,
  whiteNode,
} from '@hcb-editor/editor';
import type { CreatableNodeKind } from '../theme/meta.js';

export function defaultNode(kind: CreatableNodeKind): IrNode {
  switch (kind) {
    case 'label':
      return labelNode('label');
    case 'speak':
      return speakNode('', '');
    case 'dia':
      return diaNode('');
    case 'bgset':
      return bgsetNode('');
    case 'cgset':
      return cgsetNode('');
    case 'bsset':
      return bssetNode({ character: '', pose: 0, costume: 0, expression: 0, position: { x: 0, y: 0 }, layer: 0 });
    case 'selset':
      return selsetNode([{ text: '', label: '' }]);
    case 'audio':
      return audioNode('bgm', 0);
    case 'branch':
      return branchNode({ op: 'eq', a: 0, b: 0 }, '', '');
    case 'thread':
      return threadNode(0, '');
    case 'jump':
      return jumpNode('');
    case 'wait':
      return waitNode(1000);
    case 'msgset':
      return msgsetNode('normal');
    case 'eyecatch':
      return eyecatchNode();
    case 'bsfade':
      return bsfadeNode();
    case 'white':
      return whiteNode();
    case 'comment':
      return commentNode('');
  }
}
