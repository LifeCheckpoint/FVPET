/**
 * 投影：EditorDocument（节点图）→ 语义投影。
 * 流程图是唯一事实来源；branch 的 then/else、thread 的 entry 从连线解析。
 *
 * - projectToIr：线性化后的 IrScript（编译输入）。
 * - projectScript：剧本文本视图的只读 DSL 行（含 nodeId 供点击定位）。
 */

import type { CondExpr, IrNode, IrScript } from '@hcb-editor/hcb/ir';
import type { DocEdge, DocNode, EditorDocument } from './state.js';

function labelNameOf(document: EditorDocument, nodeId: string): string {
  const target = document.nodes.find((n) => n.id === nodeId);
  if (target?.node.kind === 'label') {
    return target.node.name;
  }
  return `lbl_${nodeId}`;
}

/** 从 startNodeId 出发，沿所有边（next/then/else/thread）求可达节点集。 */
function reachableIds(document: EditorDocument): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of document.edges) {
    const list = adj.get(e.source);
    if (list) {
      list.push(e.target);
    } else {
      adj.set(e.source, [e.target]);
    }
  }
  const visited = new Set<string>();
  const queue = [document.startNodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) {
      continue;
    }
    visited.add(id);
    for (const t of adj.get(id) ?? []) {
      if (!visited.has(t)) {
        queue.push(t);
      }
    }
  }
  return visited;
}

/** 沿 next 边做拓扑排序（仅限从 start 可达的节点）；分支目标节点按 id 顺序附加。 */
function linearize(document: EditorDocument): DocNode[] {
  const reachable = reachableIds(document);
  const nodes = document.nodes.filter((n) => reachable.has(n.id));
  const edges = document.edges.filter((e) => reachable.has(e.source) && reachable.has(e.target));
  const nextEdges = edges.filter((e) => e.kind === 'next');
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of nextEdges) {
    adj.get(e.source)?.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }
  // 分支目标（then/else/thread 边指向）不作为入口，避免其被提前线性化
  const branchTargets = new Set(
    edges.filter((e) => e.kind !== 'next').map((e) => e.target),
  );
  const queue = nodes
    .filter((n) => (indegree.get(n.id) ?? 0) === 0 && !branchTargets.has(n.id))
    .map((n) => n.id)
    .sort();
  const result: DocNode[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) {
      continue;
    }
    visited.add(id);
    const node = nodes.find((n) => n.id === id);
    if (node) {
      result.push(node);
    }
    for (const t of adj.get(id) ?? []) {
      indegree.set(t, (indegree.get(t) ?? 0) - 1);
      if ((indegree.get(t) ?? 0) === 0) {
        queue.push(t);
      }
    }
  }
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      result.push(n);
    }
  }
  return result;
}

function resolveBranchTarget(document: EditorDocument, sourceId: string, kind: 'then' | 'else'): string | undefined {
  const edge = document.edges.find((e) => e.source === sourceId && e.kind === kind);
  return edge ? labelNameOf(document, edge.target) : undefined;
}

export function projectToIr(document: EditorDocument, header: IrScript['header']): IrScript {
  // START 是纯入口标记，不进入编译输出。
  const ordered = linearize(document).filter((n) => n.id !== document.startNodeId);
  const nodes = ordered.map((docNode) => {
    const n = docNode.node;
    switch (n.kind) {
      case 'branch': {
        const thenLabel = resolveBranchTarget(document, docNode.id, 'then');
        const elseLabel = resolveBranchTarget(document, docNode.id, 'else');
        return {
          ...n,
          then: thenLabel ?? n.then,
          else: elseLabel ?? n.else,
        };
      }
      case 'thread': {
        const edge = document.edges.find((e) => e.source === docNode.id && e.kind === 'thread');
        return {
          ...n,
          entry: edge ? labelNameOf(document, edge.target) : n.entry,
        };
      }
      case 'jump': {
        const edge = document.edges.find((e) => e.source === docNode.id && e.kind === 'jump');
        return {
          ...n,
          target: edge ? labelNameOf(document, edge.target) : n.target,
        };
      }
      default:
        return n;
    }
  });
  return { header, nodes };
}

// ---------------------------------------------------------------------------
// 剧本文本视图投影（只读 DSL）
// ---------------------------------------------------------------------------

export interface ScriptLine {
  /** 对应的流程图节点 id；结构行（sel 块等）为 null。 */
  readonly nodeId: string | null;
  readonly indent: number;
  readonly text: string;
}

export function renderCond(cond: CondExpr): string {
  switch (cond.op) {
    case 'eq':
      return `${cond.a} == ${cond.b}`;
    case 'ne':
      return `${cond.a} != ${cond.b}`;
    case 'gt':
      return `${cond.a} > ${cond.b}`;
    case 'ge':
      return `${cond.a} >= ${cond.b}`;
    case 'lt':
      return `${cond.a} < ${cond.b}`;
    case 'le':
      return `${cond.a} <= ${cond.b}`;
    case 'global_eq':
      return `G[${cond.global}] == ${cond.value}`;
    case 'flag_get':
      return `flag(${cond.flag})`;
  }
}

function lineText(node: DocNode, document: EditorDocument): string[] {
  const n = node.node;
  switch (n.kind) {
    case 'label':
      return [`label ${n.name}`];
    case 'speak': {
      let text = `speak ${n.speaker} "${n.text}"`;
      if (n.voice !== undefined) {
        text += ` voice ${n.voice}`;
      }
      return [text];
    }
    case 'dia':
      return [`dia "${n.text}"`];
    case 'bgset': {
      let text = `bg ${n.background}`;
      if (n.variant !== undefined) {
        text += ` variant ${n.variant}`;
      }
      return [text];
    }
    case 'cgset':
      return [`cg ${n.name} slot ${n.slot}`];
    case 'bsset':
      return [
        `bs ${n.character} pose ${n.pose} costume ${n.costume} face ${n.expression} loc ${n.loc} z ${n.z} layer ${n.layer}`,
      ];
    case 'audio': {
      let text = `${n.type} ${n.channelOrNum}`;
      if (n.action === 'stop') {
        text += ' stop';
      }
      if (n.loop) {
        text += ' loop';
      }
      if (n.time !== undefined) {
        text += ` ${n.time}`;
      }
      return [text];
    }
    case 'selset':
      // selset 的完整块渲染在 projectScript 中单独处理，此处仅保证类型穷尽。
      return ['sel:'];
    case 'branch': {
      const thenLabel = resolveBranchTarget(document, node.id, 'then') ?? n.then;
      const elseLabel = resolveBranchTarget(document, node.id, 'else') ?? n.else;
      return [`if ${renderCond(n.cond)} → ${thenLabel} / ${elseLabel}`];
    }
    case 'thread': {
      const edge = document.edges.find((e) => e.source === node.id && e.kind === 'thread');
      const entry = edge ? labelNameOf(document, edge.target) : n.entry;
      return [`thread slot ${n.slot} → ${entry}`];
    }
    case 'jump': {
      const edge = document.edges.find((e) => e.source === node.id && e.kind === 'jump');
      const target = edge ? labelNameOf(document, edge.target) : n.target;
      return [`jump ${target}`];
    }
    case 'wait':
      return [`wait ${n.ms}`];
    case 'msgset':
      return [`msg ${n.position}`];
    case 'eyecatch':
      return ['eyecatch'];
    case 'bsfade':
      return ['bsfade'];
    case 'white':
      return ['white'];
    case 'raw':
      return [`# raw（未识别演出块 · ${n.bytes.byteLength} 字节）`];
    case 'comment':
      return [`# ${n.text}`];
  }
}

export function projectScript(document: EditorDocument): ScriptLine[] {
  const lines: ScriptLine[] = [];
  for (const docNode of linearize(document)) {
    if (docNode.node.kind === 'label') {
      lines.push({ nodeId: docNode.id, indent: 0, text: lineText(docNode, document)[0]! });
      continue;
    }
    if (docNode.node.kind === 'selset') {
      const n = docNode.node;
      lines.push({ nodeId: docNode.id, indent: 1, text: 'sel:' });
      for (const choice of n.choices) {
        lines.push({ nodeId: null, indent: 2, text: `"${choice.text}" -> ${choice.label}` });
      }
      continue;
    }
    for (const text of lineText(docNode, document)) {
      lines.push({ nodeId: docNode.id, indent: 1, text });
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 时间线投影（沿当前路径线性化的节点序列，只读）
// ---------------------------------------------------------------------------

export interface TimelineItem {
  readonly nodeId: string;
  readonly kind: IrNode['kind'];
  /** 路径深度：0 = 主线，>0 = 分支/并行子路径。 */
  readonly depth: number;
  /** 分支来源标记（then / else / thread / jump），主线为 undefined。 */
  readonly branchLabel?: string;
}

/**
 * 时间线投影：从 START 沿 next 主线深度优先展开，then/else/thread/jump
 * 作为子路径（深度 +1，带来源标记）插入。visited 去重避免 jump 回环。
 */
export function projectTimeline(document: EditorDocument): TimelineItem[] {
  const nodesById = new Map(document.nodes.map((n) => [n.id, n]));
  const outEdges = new Map<string, DocEdge[]>();
  for (const e of document.edges) {
    const list = outEdges.get(e.source);
    if (list) {
      list.push(e);
    } else {
      outEdges.set(e.source, [e]);
    }
  }

  const visited = new Set<string>();
  const items: TimelineItem[] = [];

  const walk = (nodeId: string, depth: number, branchLabel?: string): void => {
    if (visited.has(nodeId)) {
      return;
    }
    const docNode = nodesById.get(nodeId);
    if (!docNode) {
      return;
    }
    visited.add(nodeId);
    items.push({
      nodeId,
      kind: docNode.node.kind,
      depth,
      ...(branchLabel !== undefined ? { branchLabel } : {}),
    });

    const edges = outEdges.get(nodeId) ?? [];
    // 主线（next）优先展开，保持剧情主体顺序。
    for (const e of edges) {
      if (e.kind === 'next') {
        walk(e.target, depth, undefined);
      }
    }
    // 控制流边（then/else/thread/jump）作为子路径展开。
    for (const e of edges) {
      if (e.kind !== 'next') {
        walk(e.target, depth + 1, e.kind);
      }
    }
  };

  walk(document.startNodeId, 0, undefined);
  return items;
}
