import { describe, expect, it } from 'vitest';
import {
  addCharacter,
  applyCommand,
  deserializeProject,
  emptyState,
  rawNode,
  serializeProject,
} from '@hcb-editor/editor';

describe('project file round-trip', () => {
  it('serializes and restores nodes, edges, resources and raw bytes', () => {
    let state = emptyState(); // 已含 START + END
    const startId = state.document.startNodeId;
    state = applyCommand(state, { kind: 'add_node', node: { kind: 'dia', text: '你好' }, position: { x: 100, y: 0 } }).next;
    const diaId = state.selection.nodeId!;
    state = applyCommand(
      state,
      { kind: 'add_node', node: rawNode(new Uint8Array([1, 2, 3, 255]), [], { touchesGlobals: [], refsStrings: [] }), position: { x: 200, y: 0 } },
    ).next;
    const rawId = state.selection.nodeId!;
    state = applyCommand(state, addCharacter({ name: 'クロ', speakFn: null, pose: 0, costume: 0, face: 0 })).next;
    state = applyCommand(state, { kind: 'connect', source: startId, target: diaId, kind2: 'next' }).next;

    const restored = deserializeProject(serializeProject(state));

    expect(restored.header).toEqual(state.header);
    expect(restored.nextId).toBe(state.nextId);
    expect(restored.document.nodes).toHaveLength(4); // START + END + dia + raw
    expect(restored.document.startNodeId).toBe('start');
    expect(restored.document.edges).toHaveLength(1);
    expect(restored.resources.characters).toHaveLength(1);
    expect(restored.resources.characters[0]!.name).toBe('クロ');

    const raw = restored.document.nodes.find((n) => n.id === rawId)!.node;
    expect(raw.kind).toBe('raw');
    if (raw.kind === 'raw') {
      expect([...raw.bytes]).toEqual([1, 2, 3, 255]);
    }
  });
});
