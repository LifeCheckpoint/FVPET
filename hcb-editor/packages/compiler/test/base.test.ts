import { describe, expect, it } from 'vitest';
import { compileProject } from '@hcb-editor/compiler';
import { decodeHcb } from '@hcb-editor/hcb/decompile';
import type { IrScript } from '@hcb-editor/hcb/ir';

const ir: IrScript = {
  header: { schemaVersion: 1, engine: 'fvp', game: 'sakura-moyu', nls: 'sjis' },
  nodes: [
    { kind: 'label', name: 'start' },
    { kind: 'speak', speaker: 'クロ', text: 'おはよう。' },
    { kind: 'dia', text: '……' },
  ],
};

describe('base-game compile (sakura-moyu)', () => {
  it('compiles speak/dia against the real sysdesc and decodes back', () => {
    const bytes = compileProject(ir, 'sjis');
    expect(bytes.length).toBeGreaterThan(0);

    const decoded = decodeHcb(bytes, 'sjis');
    expect(decoded.sysdesc.syscalls.length).toBe(148);
    expect(decoded.sysdesc.entryPoint).toBe(4);
    expect(decoded.instructions.length).toBeGreaterThan(0);

    // 输出应含 speak 名栏调用（call 到 0x04 = クロ）
    const calls = decoded.instructions.filter((i) => i.mnemonic === 'call');
    expect(calls.length).toBeGreaterThan(0);
  });

  it('rejects an unknown speaker', () => {
    const bad: IrScript = {
      ...ir,
      nodes: [{ kind: 'label', name: 'start' }, { kind: 'speak', speaker: '不存在', text: 'x' }],
    };
    expect(() => compileProject(bad, 'sjis')).toThrow();
  });
});
