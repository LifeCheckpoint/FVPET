import { describe, expect, it } from 'vitest';
import { addNode, applyCommand, bssetNode, emptyState, projectToIr } from '@hcb-editor/editor';
import { buildPreviewScript } from '@hcb-editor/ui';

describe('buildPreviewScript', () => {
  it('projects speak/dia into the text queue and bsset into prims', () => {
    let state = emptyState();
    const startId = state.document.startNodeId;
    state = applyCommand(state, { kind: 'add_node', node: { kind: 'speak', speaker: 'クロ', text: '你好' }, position: { x: 100, y: 0 } }).next;
    const speakId = state.selection.nodeId!;
    state = applyCommand(state, { kind: 'add_node', node: { kind: 'dia', text: '……' }, position: { x: 200, y: 0 } }).next;
    const diaId = state.selection.nodeId!;
    state = applyCommand(state, addNode(bssetNode({ character: 'クロ', pose: 0, costume: 0, expression: 0, position: { x: 120, y: 40 }, layer: 1 }), { x: 300, y: 0 })).next;
    const bsId = state.selection.nodeId!;

    state = applyCommand(state, { kind: 'connect', source: startId, target: speakId, kind2: 'next' }).next;
    state = applyCommand(state, { kind: 'connect', source: speakId, target: diaId, kind2: 'next' }).next;
    state = applyCommand(state, { kind: 'connect', source: diaId, target: bsId, kind2: 'next' }).next;

    const script = buildPreviewScript(state.document, state.header);
    expect(script.texts).toEqual([
      { text: '你好', speaker: 'クロ' },
      { text: '……' },
    ]);
    expect(script.prims).toHaveLength(1);
    expect(script.prims[0]!.z).toBe(1);
    expect(script.prims[0]!.label).toBe('クロ');
  });

  it('uses the projected IR ordering', () => {
    const state = emptyState();
    const ir = projectToIr(state.document, state.header);
    expect(ir.nodes).toHaveLength(0);
  });
});
