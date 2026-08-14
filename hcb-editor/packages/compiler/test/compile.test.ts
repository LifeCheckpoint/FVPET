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

  it('compiles cgset to six arguments + the preprocessed base CG-specific function', () => {
    const nls: Nls = 'sjis';
    const cgIr: IrScript = {
      header: { schemaVersion: 1, engine: 'fvp', game: 'test', nls: 'sjis' },
      nodes: [
        { kind: 'label', name: 'start' },
        { kind: 'cgset', name: 'ASAHI_E011A1', slot: 240, mode: 5, flag: 2 },
      ],
    };
    const bytes = compile(cgIr, {
      sysdesc: emptySysdesc(),
      tables: {
        characters: {},
        backgrounds: {},
        cgs: { ASAHI_E011A1: { fn: 0x000035b6 } },
        globals: {},
      },
      nls,
    });
    const decoded = decodeHcb(bytes, nls);
    const idx = decoded.instructions.findIndex(
      (i) => i.mnemonic === 'call' && i.args.kind === 'x32' && i.args.target === 0x000035b6,
    );
    expect(idx).toBeGreaterThanOrEqual(6);
    expect(decoded.instructions.slice(idx - 6, idx - 1).every((i) => i.mnemonic === 'push_nil')).toBe(true);
    expect(decoded.instructions[idx - 1]!.mnemonic).toBe('push_i16');
    expect(decoded.instructions.some(
      (i) => i.mnemonic === 'call' && i.args.kind === 'x32' && i.args.target === 0x000373a5,
    )).toBe(false);
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
      expect(jmp!.args.target).toBe(12); // init_stack(3) + start(7) + raw(5 字节) = end 地址 12
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

    const out = compileWithBase(scriptIr, ctx, baseData, new Uint8Array(0), baseCodeEnd);
    // 底座库代码区逐字节保留（合成底座无 base_off 引用，patch 不改变任何字节）
    expect(Buffer.from(out.subarray(4, baseCodeEnd)).equals(Buffer.from(baseData.subarray(4, baseCodeEnd)))).toBe(true);

    const decoded = decodeHcb(out, nls);
    // 新脚本从 mainOffset（库代码结束）开始，以 init_stack 开头。
    const entry = decoded.instructions.find((i) => i.addr === baseCodeEnd);
    expect(entry).toBeDefined();
    expect(entry!.mnemonic).toBe('init_stack');
    expect(decoded.instructions.length).toBeGreaterThan(0);
  });
});
