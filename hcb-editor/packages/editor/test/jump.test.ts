import { describe, expect, it } from 'vitest';
import {
  addJumpNode,
  applyCommand,
  connectNodes,
  createProject,
  projectToIr,
  validateConnect,
} from '../src/index.js';

describe('jump node', () => {
  it('validates jump edge endpoints', () => {
    let state = createProject({ game: 'sakura-moyu', nls: 'sjis' });
    state = applyCommand(state, addJumpNode('', { x: 0, y: 0 })).next; // n1
    state = applyCommand(state, { kind: 'add_node', node: { kind: 'label', name: 'loop' }, position: { x: 0, y: 0 } }).next; // n2
    state = applyCommand(state, { kind: 'add_node', node: { kind: 'dia', text: 'x' }, position: { x: 0, y: 0 } }).next; // n3

    expect(validateConnect(state.document, 'n1', 'n1', 'jump')).not.toBeNull(); // 自连
    expect(validateConnect(state.document, 'start', 'n2', 'jump')).not.toBeNull(); // 非 jump 源
    expect(validateConnect(state.document, 'n1', 'n3', 'jump')).not.toBeNull(); // 非 label 目标
    expect(validateConnect(state.document, 'n1', 'n2', 'jump')).toBeNull();
  });

  it('projectToIr resolves jump target from its edge', () => {
    let state = createProject({ game: 'sakura-moyu', nls: 'sjis' });
    state = applyCommand(state, addJumpNode('', { x: 0, y: 0 })).next; // n1
    state = applyCommand(state, { kind: 'add_node', node: { kind: 'label', name: 'loop' }, position: { x: 0, y: 0 } }).next; // n2
    state = applyCommand(state, connectNodes('start', 'n1', 'next')).next;
    state = applyCommand(state, connectNodes('n1', 'n2', 'jump')).next;

    const ir = projectToIr(state.document, state.header);
    const jump = ir.nodes.find((n) => n.kind === 'jump');
    expect(jump && jump.kind === 'jump' ? jump.target : null).toBe('loop');
  });
});
