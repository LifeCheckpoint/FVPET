import { describe, expect, it } from 'vitest';
import { decodeHcb } from '@hcb-editor/hcb/decompile';
import type { HcbSysdesc, Nls } from '@hcb-editor/hcb/core';
import type { IrScript } from '@hcb-editor/hcb/ir';
import { compile, compileWithBase, encodeFromFlat } from '@hcb-editor/compiler/passes';

/** 最小合成底座 sysdesc（无 syscall 导入表，供无 syscall 的 IR 编译）。 */
function emptySysdesc(): HcbSysdesc {
  return {
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
  };
}

const ir: IrScript = {
  header: { schemaVersion: 1, engine: 'fvp', game: 'test', nls: 'sjis' },
  nodes: [
    { kind: 'label', name: 'start' },
    { kind: 'dia', text: 'こんにちは、世界。' },
    { kind: 'dia', text: 'これは合成フィクスチャです。' },
    { kind: 'branch', cond: { op: 'global_eq', global: 103, value: 1 }, then: 'start', else: 'end' },
    { kind: 'label', name: 'end' },
    { kind: 'dia', text: 'おわり。' },
  ],
};

describe('compile pipeline (synthetic, CI-independent)', () => {
  it('compiles semantic IR to HCB and re-encodes byte-identically', () => {
    const nls: Nls = 'sjis';
    const bytes = compile(ir, {
      sysdesc: emptySysdesc(),
      tables: { characters: {}, backgrounds: {}, globals: {} },
      nls,
    });

    const decoded = decodeHcb(bytes, nls);
    expect(decoded.instructions.length).toBeGreaterThan(0);
    expect(decoded.functions.length).toBeGreaterThan(0);

    const reEncoded = encodeFromFlat(decoded.instructions, decoded.sysdesc, nls);
    expect(Buffer.from(reEncoded).equals(Buffer.from(bytes))).toBe(true);
  });

  it('preserves branch target labels through assemble/layout', () => {
    const nls: Nls = 'sjis';
    const bytes = compile(ir, {
      sysdesc: emptySysdesc(),
      tables: { characters: {}, backgrounds: {}, globals: {} },
      nls,
    });
    const decoded = decodeHcb(bytes, nls);
    const jz = decoded.instructions.find((i) => i.mnemonic === 'jz');
    expect(jz).toBeDefined();
  });

  it('passes raw bytes through and relocates a jmp to a label', () => {
    const nls: Nls = 'sjis';
    // jmp 指令：0x06 + 4 字节占位目标；重定位指向 'end' 标签。
    const rawIr: IrScript = {
      header: ir.header,
      nodes: [
        { kind: 'label', name: 'start' },
        {
          kind: 'raw',
          bytes: new Uint8Array([0x06, 0x00, 0x00, 0x00, 0x00]),
          relocations: [{ kind: 'jmp', offset: 1, target: 'end' }],
          sideEffects: { touchesGlobals: [], refsStrings: [] },
        },
        { kind: 'label', name: 'end' },
        { kind: 'dia', text: 'ok' },
      ],
    };
    const bytes = compile(rawIr, {
      sysdesc: emptySysdesc(),
      tables: { characters: {}, backgrounds: {}, globals: {} },
      nls,
    });
    const decoded = decodeHcb(bytes, nls);
    const jmp = decoded.instructions.find((i) => i.mnemonic === 'jmp');
    expect(jmp).toBeDefined();
    expect(jmp!.args.kind).toBe('x32');
    if (jmp!.args.kind === 'x32') {
      expect(jmp!.args.target).toBe(9); // start(4) + raw(5 字节) = end 地址 9
    }
  });

  it('splices base library code verbatim and appends the new script (patchBase)', () => {
    const nls: Nls = 'sjis';
    const libraryIr: IrScript = {
      header: ir.header,
      nodes: [{ kind: 'label', name: 'lib' }, { kind: 'dia', text: '库函数' }],
    };
    const scriptIr: IrScript = {
      header: ir.header,
      nodes: [{ kind: 'label', name: 'start' }, { kind: 'dia', text: '脚本' }],
    };
    const ctx = { sysdesc: emptySysdesc(), tables: { characters: {}, backgrounds: {}, globals: {} }, nls };

    const baseData = compile(libraryIr, ctx);
    const baseCodeEnd = decodeHcb(baseData, nls).sysdesc.sysDescOffset;

    const out = compileWithBase(scriptIr, ctx, baseData);
    // 底座代码区逐字节保留
    expect(Buffer.from(out.subarray(4, baseCodeEnd)).equals(Buffer.from(baseData.subarray(4, baseCodeEnd)))).toBe(true);

    const decoded = decodeHcb(out, nls);
    expect(decoded.sysdesc.entryPoint).toBe(baseCodeEnd);
    expect(decoded.instructions.length).toBeGreaterThan(0);
  });
});
