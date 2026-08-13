import { describe, expect, it } from 'vitest';
import { addNode, applyCommand, emptyState, projectScript, projectTimeline, projectToIr, threadNode } from '@hcb-editor/editor';

const HEADER = { schemaVersion: 1, engine: 'fvp', game: 'test', nls: 'sjis' } as const;

function buildBranchDocument() {
  let state = emptyState(); // 已含 START('start') + END('end')
  state = applyCommand(state, {
    kind: 'add_node',
    node: { kind: 'branch', cond: { op: 'global_eq', global: 103, value: 1 }, then: '', else: '' },
    position: { x: 100, y: 0 },
  }).next;
  state = applyCommand(state, { kind: 'add_node', node: { kind: 'label', name: 'yes' }, position: { x: 200, y: -100 } }).next;
  state = applyCommand(state, { kind: 'add_node', node: { kind: 'label', name: 'no' }, position: { x: 200, y: 100 } }).next;

  const branch = state.document.nodes.find((n) => n.node.kind === 'branch')!;
  const yes = state.document.nodes.find((n) => n.node.kind === 'label' && n.node.name === 'yes')!;
  const no = state.document.nodes.find((n) => n.node.kind === 'label' && n.node.name === 'no')!;

  state = applyCommand(state, { kind: 'connect', source: state.document.startNodeId, target: branch.id, kind2: 'next' }).next;
  state = applyCommand(state, { kind: 'connect', source: branch.id, target: yes.id, kind2: 'then' }).next;
  state = applyCommand(state, { kind: 'connect', source: branch.id, target: no.id, kind2: 'else' }).next;
  return state.document;
}

describe('projection', () => {
  it('linearizes next edges and resolves branch then/else from edges (START 剥离)', () => {
    const document = buildBranchDocument();
    const ir = projectToIr(document, HEADER);

    expect(ir.nodes.map((n) => n.kind)).toEqual(['branch', 'label', 'label']);

    const branch = ir.nodes[0]!;
    expect(branch.kind === 'branch' && branch.then).toBe('yes');
    expect(branch.kind === 'branch' && branch.else).toBe('no');
  });

  it('excludes nodes not reachable from START', () => {
    let state = emptyState();
    state = applyCommand(state, addNode({ kind: 'dia', text: '可达' }, { x: 100, y: 0 })).next;
    const reachableId = state.selection.nodeId!;
    state = applyCommand(state, { kind: 'connect', source: state.document.startNodeId, target: reachableId, kind2: 'next' }).next;
    // 一个悬空节点，不从 START 可达
    state = applyCommand(state, addNode({ kind: 'dia', text: '悬空' }, { x: 300, y: 0 })).next;
    const danglingId = state.selection.nodeId!;

    const ir = projectToIr(state.document, HEADER);
    expect(ir.nodes.map((n) => n.kind)).toEqual(['dia']);
    const projected = state.document.nodes.find((n) => n.id === reachableId)!;
    expect(projected.node.kind === 'dia' && projected.node.text).toBe('可达');
    expect(state.document.nodes.some((n) => n.id === danglingId)).toBe(true); // 仍在文档中
  });

  it('resolves thread entry from its thread edge', () => {
    let state = emptyState();
    state = applyCommand(state, addNode(threadNode(1, ''), { x: 100, y: 0 })).next;
    const threadId = state.selection.nodeId!;
    state = applyCommand(state, { kind: 'add_node', node: { kind: 'label', name: 't_entry' }, position: { x: 200, y: 0 } }).next;
    const labelId = state.selection.nodeId!;

    state = applyCommand(state, { kind: 'connect', source: state.document.startNodeId, target: threadId, kind2: 'next' }).next;
    state = applyCommand(state, { kind: 'connect', source: threadId, target: labelId, kind2: 'thread' }).next;

    const ir = projectToIr(state.document, HEADER);
    const projectedThread = ir.nodes.find((n) => n.kind === 'thread');
    expect(projectedThread?.kind === 'thread' && projectedThread.entry).toBe('t_entry');
  });

  it('projects the script text view as DSL lines with node ids', () => {
    let state = emptyState();
    const startId = state.document.startNodeId;
    state = applyCommand(state, {
      kind: 'add_node',
      node: { kind: 'speak', speaker: 'クロ', text: '今天的风很大。', voice: 123 },
      position: { x: 100, y: 0 },
    }).next;
    const speakId = state.selection.nodeId!;
    state = applyCommand(state, {
      kind: 'add_node',
      node: { kind: 'selset', choices: [{ text: '去学校', label: 'go_school' }, { text: '回家', label: 'go_home' }], resultGlobal: 103 },
      position: { x: 200, y: 0 },
    }).next;
    const selId = state.selection.nodeId!;

    state = applyCommand(state, { kind: 'connect', source: startId, target: speakId, kind2: 'next' }).next;
    state = applyCommand(state, { kind: 'connect', source: speakId, target: selId, kind2: 'next' }).next;

    const lines = projectScript(state.document);
    expect(lines).toEqual([
      { nodeId: startId, indent: 0, text: 'label 开始' },
      { nodeId: speakId, indent: 1, text: 'speak クロ "今天的风很大。" voice 123' },
      { nodeId: selId, indent: 1, text: 'sel:' },
      { nodeId: null, indent: 2, text: '"去学校" -> go_school' },
      { nodeId: null, indent: 2, text: '"回家" -> go_home' },
    ]);
  });

  it('projects the timeline as the linearized reachable sequence', () => {
    let state = emptyState();
    const startId = state.document.startNodeId;
    state = applyCommand(state, { kind: 'add_node', node: { kind: 'speak', speaker: 'A', text: 'x' }, position: { x: 100, y: 0 } }).next;
    const speakId = state.selection.nodeId!;
    state = applyCommand(state, { kind: 'connect', source: startId, target: speakId, kind2: 'next' }).next;

    const timeline = projectTimeline(state.document);
    expect(timeline.map((i) => i.kind)).toEqual(['label', 'speak']);
    expect(timeline.map((i) => i.nodeId)).toEqual([startId, speakId]);
  });
});
