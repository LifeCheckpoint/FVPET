/**
 * 编辑器文档模型。
 * 单一事实来源：工程 = header + document（节点图）+ resources（资源表）。
 * 流程图是唯一编辑面：节点带稳定 id 与位置，连线表达控制流；IrScript 是编译投影。
 */

import type { IrHeader, IrNode } from '@hcb-editor/hcb/ir';
import { emptyResources, type ProjectResources } from './resources.js';
import { DEFAULT_BASE_GAME } from './base-games.js';

export interface DocNode {
  readonly id: string;
  readonly node: IrNode;
  readonly x: number;
  readonly y: number;
}

/**
 * 连线种类：
 * - next：顺序流（线性化顺序）
 * - then / else：branch 节点的两个分支（target 必须为 label 节点）
 * - thread：thread 节点的入口（target 必须为 label 节点）
 */
export type EdgeKind = 'next' | 'then' | 'else' | 'thread';

export interface DocEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: EdgeKind;
}

export interface EditorDocument {
  readonly nodes: readonly DocNode[];
  readonly edges: readonly DocEdge[];
  /** 剧情入口节点 id（不可删除，编译/预览只纳其可达节点）。 */
  readonly startNodeId: string;
}

export interface EditorState {
  readonly header: IrHeader;
  readonly document: EditorDocument;
  readonly resources: ProjectResources;
  readonly selection: { readonly nodeId: string | null };
  /** 单调递增 id 计数器（确定性：同序列命令产生同 id） */
  readonly nextId: number;
}

/** 新建工程：选底座游戏 + NLS，生成空剧情骨架（含不可删除的 START + 可删的 END 标记）。 */
export function createProject(opts: { readonly game: string; readonly nls: IrHeader['nls'] }): EditorState {
  return {
    header: { schemaVersion: 1, engine: 'fvp', game: opts.game, nls: opts.nls },
    document: {
      nodes: [
        { id: 'start', node: { kind: 'label', name: '开始' }, x: 80, y: 300 },
        { id: 'end', node: { kind: 'label', name: '结束' }, x: 840, y: 300 },
      ],
      edges: [],
      startNodeId: 'start',
    },
    resources: emptyResources(),
    selection: { nodeId: null },
    nextId: 1,
  };
}

export function emptyState(): EditorState {
  return createProject({ game: DEFAULT_BASE_GAME, nls: 'sjis' });
}
