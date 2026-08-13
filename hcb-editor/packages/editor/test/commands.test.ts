import { describe, expect, it } from 'vitest';
import {
  addBranchNode,
  addDiaNode,
  addLabelNode,
  addSpeakNode,
  applyCommand,
  connectNodes,
  editSpeakFields,
  emptyState,
  moveNode,
  reconnectNodes,
  validateConnect,
  validateReconnect,
} from '@hcb-editor/editor';

describe('node helpers', () => {
  it('addSpeakNode creates a speak node with optional fields', () => {
    const { next } = applyCommand(
      emptyState(),
      addSpeakNode('クロ', '今天的风很大。', { x: 10, y: 20 }, { alias: '一磨', voice: 123 }),
    );
    const node = next.document.nodes.find((n) => n.id === next.selection.nodeId)!.node;
    expect(node.kind).toBe('speak');
    if (node.kind === 'speak') {
      expect(node.speaker).toBe('クロ');
      expect(node.text).toBe('今天的风很大。');
      expect(node.alias).toBe('一磨');
      expect(node.voice).toBe(123);
    }
  });

  it('addBranchNode creates a branch with empty then/else to be wired by edges', () => {
    const { next } = applyCommand(
      emptyState(),
      addBranchNode({ op: 'global_eq', global: 103, value: 1 }, { x: 0, y: 0 }),
    );
    const node = next.document.nodes.find((n) => n.id === next.selection.nodeId)!.node;
    expect(node.kind).toBe('branch');
    if (node.kind === 'branch') {
      expect(node.then).toBe('');
      expect(node.else).toBe('');
    }
  });
});

describe('validateConnect', () => {
  it('rejects self connection', () => {
    const { next } = applyCommand(emptyState(), addLabelNode('a', { x: 0, y: 0 }));
    const id = next.selection.nodeId!;
    expect(validateConnect(next.document, id, id, 'next')).not.toBeNull();
  });

  it('rejects then edge from a non-branch source', () => {
    let state = applyCommand(emptyState(), addLabelNode('a', { x: 0, y: 0 })).next;
    const a = state.selection.nodeId!;
    state = applyCommand(state, addLabelNode('b', { x: 100, y: 0 })).next;
    const b = state.selection.nodeId!;
    expect(validateConnect(state.document, a, b, 'then')).toContain('branch');
  });

  it('rejects then edge targeting a non-label node', () => {
    let state = applyCommand(
      emptyState(),
      addBranchNode({ op: 'eq', a: 0, b: 1 }, { x: 0, y: 0 }),
    ).next;
    const branch = state.selection.nodeId!;
    state = applyCommand(state, addDiaNode('x', { x: 100, y: 0 })).next;
    const dia = state.selection.nodeId!;
    expect(validateConnect(state.document, branch, dia, 'then')).toContain('label');
  });

  it('rejects duplicate next edge from the same source', () => {
    let state = applyCommand(emptyState(), addLabelNode('a', { x: 0, y: 0 })).next;
    const a = state.selection.nodeId!;
    state = applyCommand(state, addLabelNode('b', { x: 100, y: 0 })).next;
    const b = state.selection.nodeId!;
    state = applyCommand(state, addLabelNode('c', { x: 200, y: 0 })).next;
    const c = state.selection.nodeId!;
    state = applyCommand(state, connectNodes(a, b, 'next')).next;
    expect(validateConnect(state.document, a, c, 'next')).toContain('next');
  });

  it('accepts a valid then edge from branch to label', () => {
    let state = applyCommand(
      emptyState(),
      addBranchNode({ op: 'eq', a: 0, b: 1 }, { x: 0, y: 0 }),
    ).next;
    const branch = state.selection.nodeId!;
    state = applyCommand(state, addLabelNode('yes', { x: 100, y: 0 })).next;
    const yes = state.selection.nodeId!;
    expect(validateConnect(state.document, branch, yes, 'then')).toBeNull();
  });
});

describe('applyCommand connection guards', () => {
  it('throws on invalid connect instead of mutating', () => {
    let state = applyCommand(emptyState(), addLabelNode('a', { x: 0, y: 0 })).next;
    const a = state.selection.nodeId!;
    state = applyCommand(state, addLabelNode('b', { x: 100, y: 0 })).next;
    const b = state.selection.nodeId!;
    expect(() => applyCommand(state, connectNodes(a, b, 'then'))).toThrow();
  });

  it('reconnect replaces an existing next edge', () => {
    let state = applyCommand(emptyState(), addLabelNode('a', { x: 0, y: 0 })).next;
    const a = state.selection.nodeId!;
    state = applyCommand(state, addLabelNode('b', { x: 100, y: 0 })).next;
    const b = state.selection.nodeId!;
    state = applyCommand(state, addLabelNode('c', { x: 200, y: 0 })).next;
    const c = state.selection.nodeId!;
    state = applyCommand(state, connectNodes(a, b, 'next')).next;
    state = applyCommand(state, reconnectNodes(a, c, 'next')).next;

    const nextEdges = state.document.edges.filter((e) => e.source === a && e.kind === 'next');
    expect(nextEdges).toHaveLength(1);
    expect(nextEdges[0]!.target).toBe(c);
  });

  it('reconnect validates endpoints', () => {
    const state = applyCommand(emptyState(), addLabelNode('a', { x: 0, y: 0 })).next;
    const a = state.selection.nodeId!;
    expect(validateReconnect(state.document, a, 'missing', 'next')).toContain('不存在');
  });
});

describe('editSpeakFields', () => {
  it('merges provided fields and preserves the rest', () => {
    let state = applyCommand(
      emptyState(),
      addSpeakNode('クロ', 'hi', { x: 0, y: 0 }, { alias: '一磨' }),
    ).next;
    const id = state.selection.nodeId!;
    state = applyCommand(state, editSpeakFields(state, id, { text: 'yo', voice: 3 })).next;

    const node = state.document.nodes.find((n) => n.id === id)!.node;
    expect(node.kind).toBe('speak');
    if (node.kind === 'speak') {
      expect(node.speaker).toBe('クロ');
      expect(node.alias).toBe('一磨');
      expect(node.text).toBe('yo');
      expect(node.voice).toBe(3);
    }
  });

  it('throws when editing a non-speak node', () => {
    const state = applyCommand(emptyState(), addDiaNode('x', { x: 0, y: 0 })).next;
    const id = state.selection.nodeId!;
    expect(() => editSpeakFields(state, id, { text: 'y' })).toThrow();
  });
});

describe('moveNode', () => {
  it('moves a node to a new position', () => {
    const first = applyCommand(emptyState(), addDiaNode('x', { x: 0, y: 0 })).next;
    const id = first.selection.nodeId!;
    const { next } = applyCommand(first, moveNode(id, { x: 42, y: 7 }));
    expect(next.document.nodes.find((n) => n.id === id)!.x).toBe(42);
    expect(next.document.nodes.find((n) => n.id === id)!.y).toBe(7);
  });
});
