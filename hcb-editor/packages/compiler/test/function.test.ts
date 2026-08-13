import { describe, expect, it } from 'vitest';
import { compileFunctionSegment, splitIrFunctions } from '@hcb-editor/compiler';
import { decodeHcb } from '@hcb-editor/hcb/decompile';
import type { IrScript } from '@hcb-editor/hcb/ir';

const ir: IrScript = {
  header: { schemaVersion: 1, engine: 'fvp', game: 'test', nls: 'sjis' },
  nodes: [
    { kind: 'label', name: 'prologue' },
    { kind: 'dia', text: '序章' },
    { kind: 'label', name: 'scene1' },
    { kind: 'dia', text: '第一幕' },
    { kind: 'dia', text: '第二句' },
  ],
};

const ctx = {
  sysdesc: {
    sysDescOffset: 0,
    entryPoint: 4,
    nonVolatileGlobalCount: 0,
    volatileGlobalCount: 0,
    gameMode: 0,
    gameModeReserved: 0,
    gameTitle: 'test',
    gameTitleOriginal: 'test',
    titleRawBytes: new Uint8Array([0x74, 0x65, 0x73, 0x74, 0x00]),
    syscallCount: 0,
    syscalls: [],
    customSyscallCount: 0,
    sysdescEndOffset: 0,
  },
  tables: { characters: {}, backgrounds: {}, globals: {} },
  nls: 'sjis' as const,
};

describe('function-level compile primitives', () => {
  it('splits IR into label-delimited functions', () => {
    const funcs = splitIrFunctions(ir);
    expect(funcs.map((f) => f.name)).toEqual(['prologue', 'scene1']);
    expect(funcs[0]!.ir.nodes.map((n) => n.kind)).toEqual(['dia']);
    expect(funcs[1]!.ir.nodes.map((n) => n.kind)).toEqual(['dia', 'dia']);
  });

  it('compiles a single function segment standalone', () => {
    const funcs = splitIrFunctions(ir);
    const bytes = compileFunctionSegment(funcs[1]!, ctx);
    const decoded = decodeHcb(bytes, 'sjis');
    expect(decoded.instructions.length).toBeGreaterThan(0);
    expect(decoded.sysdesc.entryPoint).toBe(4);
  });
});
