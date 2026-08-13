import { decodeHcb } from '@hcb-editor/hcb/decompile';
import type { HcbSysdesc, Nls } from '@hcb-editor/hcb/core';
import type { IrScript } from '@hcb-editor/hcb/ir';
import { compile, encodeFromFlat } from '@hcb-editor/compiler/passes';

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
    { kind: 'branch', cond: { op: 'global_eq', global: 103, value: 1 }, then: 'start', else: 'end' },
    { kind: 'label', name: 'end' },
    { kind: 'dia', text: 'おわり。' },
  ],
};

console.log('step: compile');
const nls: Nls = 'sjis';
const bytes = compile(ir, { sysdesc: emptySysdesc(), tables: { characters: {}, backgrounds: {}, globals: {} }, nls });
console.log('compiled bytes', bytes.length);

console.log('step: decode');
const decoded = decodeHcb(bytes, nls);
console.log('decoded instructions', decoded.instructions.length, 'functions', decoded.functions.length);

console.log('step: re-encode');
const re = encodeFromFlat(decoded.instructions, decoded.sysdesc, nls);
console.log('re-encoded bytes', re.length, 'identical', Buffer.from(re).equals(Buffer.from(bytes)));
console.log('done');
