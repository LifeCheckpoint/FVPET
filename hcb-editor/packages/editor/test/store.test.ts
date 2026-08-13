import { describe, expect, it } from 'vitest';
import { applyCommand, EditorStore, emptyState } from '@hcb-editor/editor';

describe('commands', () => {
  it('adds and selects a node', () => {
    const { next } = applyCommand(emptyState(), {
      kind: 'add_node',
      node: { kind: 'dia', text: 'hi' },
      position: { x: 0, y: 0 },
    });
    expect(next.document.nodes).toHaveLength(3); // START + END + 新增
    expect(next.selection.nodeId).toBe('n1');
    expect(next.document.nodes.some((n) => n.id === 'n1')).toBe(true);
  });

  it('removes node together with its edges', () => {
    let state = emptyState();
    state = applyCommand(state, { kind: 'add_node', node: { kind: 'label', name: 'a' }, position: { x: 0, y: 0 } }).next;
    const aId = state.selection.nodeId!;
    state = applyCommand(state, { kind: 'add_node', node: { kind: 'dia', text: 'x' }, position: { x: 100, y: 0 } }).next;
    const bId = state.selection.nodeId!;
    state = applyCommand(state, { kind: 'connect', source: aId, target: bId, kind2: 'next' }).next;
    expect(state.document.edges).toHaveLength(1);

    const { next } = applyCommand(state, { kind: 'remove_node', id: bId });
    expect(next.document.nodes.some((n) => n.id === bId)).toBe(false);
    expect(next.document.edges).toHaveLength(0);
  });

  it('edits a node field', () => {
    const { next } = applyCommand(emptyState(), {
      kind: 'add_node',
      node: { kind: 'dia', text: 'before' },
      position: { x: 0, y: 0 },
    });
    const id = next.selection.nodeId!;
    const result = applyCommand(next, { kind: 'edit_node', id, node: { kind: 'dia', text: 'after' } });
    const node = result.next.document.nodes.find((n) => n.id === id)!.node;
    expect(node.kind === 'dia' && node.text).toBe('after');
  });

  it('rejects removing the START node', () => {
    const state = emptyState();
    expect(() => applyCommand(state, { kind: 'remove_node', id: state.document.startNodeId })).toThrow();
  });
});

describe('undo/redo', () => {
  it('undoes and redoes add_node', () => {
    const store = new EditorStore(emptyState());
    const baseCount = store.current.document.nodes.length;
    store.dispatch({ kind: 'add_node', node: { kind: 'dia', text: 'hi' }, position: { x: 0, y: 0 } });
    expect(store.current.document.nodes).toHaveLength(baseCount + 1);

    expect(store.undo()).toBe(true);
    expect(store.current.document.nodes).toHaveLength(baseCount);

    expect(store.redo()).toBe(true);
    expect(store.current.document.nodes).toHaveLength(baseCount + 1);
  });

  it('undoes move_node', () => {
    const store = new EditorStore(emptyState());
    store.dispatch({ kind: 'add_node', node: { kind: 'dia', text: 'hi' }, position: { x: 0, y: 0 } });
    const id = store.current.selection.nodeId!;
    store.dispatch({ kind: 'move_node', id, position: { x: 42, y: 7 } });
    expect(store.current.document.nodes.find((n) => n.id === id)!.x).toBe(42);

    store.undo();
    expect(store.current.document.nodes.find((n) => n.id === id)!.x).toBe(0);
  });
});
