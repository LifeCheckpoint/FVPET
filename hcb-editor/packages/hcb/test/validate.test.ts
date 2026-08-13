import { describe, expect, it } from 'vitest';
import type { IrScript } from '../src/ir/types.js';
import { validateIr } from '../src/validate/index.js';

function script(nodes: IrScript['nodes']): IrScript {
  return { header: { schemaVersion: 1, engine: 'fvp', game: 'sakura-moyu', nls: 'sjis' }, nodes };
}

describe('validateIr', () => {
  it('passes a well-formed script', () => {
    const issues = validateIr(
      script([
        { kind: 'label', name: 'start' },
        { kind: 'dia', text: 'hello' },
        { kind: 'label', name: 'loop' },
        { kind: 'jump', target: 'loop' },
      ]),
    );
    expect(issues).toEqual([]);
  });

  it('flags dangling control-flow targets', () => {
    const issues = validateIr(
      script([
        { kind: 'label', name: 'start' },
        { kind: 'branch', cond: { op: 'eq', a: 0, b: 0 }, then: 'yes', else: 'no' },
        { kind: 'jump', target: 'missing' },
      ]),
    );
    expect(issues.map((i) => i.kind)).toContain('dangling_label');
    expect(issues.length).toBe(3);
  });

  it('flags duplicate labels', () => {
    const issues = validateIr(
      script([
        { kind: 'label', name: 'a' },
        { kind: 'label', name: 'a' },
      ]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe('duplicate_label');
  });

  it('flags unwired control-flow targets（空目标）', () => {
    const issues = validateIr(
      script([
        { kind: 'label', name: 'start' },
        { kind: 'jump', target: '' },
        { kind: 'branch', cond: { op: 'eq', a: 0, b: 0 }, then: '', else: '' },
        { kind: 'thread', slot: 0, entry: '' },
      ]),
    );
    expect(issues).toHaveLength(4);
    expect(issues.every((i) => i.kind === 'dangling_label')).toBe(true);
  });
});
