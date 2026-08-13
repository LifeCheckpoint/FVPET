import { describe, expect, it } from 'vitest';
import { compileProject } from '@hcb-editor/compiler';
import { decodeHcb } from '@hcb-editor/hcb/decompile';
import type { IrScript } from '@hcb-editor/hcb/ir';

/**
 * 合成工程（G21）：覆盖全部剧情节点种类的 IR → 编译 → 解码，
 * 断言每种节点的模板展开都落到了预期符号（call/syscall/jmp/jz）。
 * 这是「IR→编译→跑通 + golden」的编译侧回归；假引擎跑通由 rfvp 包测试与 e2e 冒烟覆盖。
 */
const ir: IrScript = {
  header: { schemaVersion: 1, engine: 'fvp', game: 'sakura-moyu', nls: 'sjis' },
  nodes: [
    { kind: 'label', name: 'start' },
    { kind: 'speak', speaker: 'クロ', text: 'おはよう。' },
    { kind: 'dia', text: '合成工程跑通' },
    { kind: 'bgset', background: 'bg_240' },
    {
      kind: 'bsset',
      character: 'クロ',
      pose: 1,
      costume: 1,
      expression: 2,
      layout: 0,
      position: { x: 0, y: 0 },
      layer: 3,
    },
    { kind: 'audio', type: 'bgm', channelOrNum: 1 },
    { kind: 'wait', ms: 500 },
    { kind: 'msgset', position: 'normal' },
    { kind: 'selset', choices: [{ text: '進む', label: 'go' }], resultGlobal: 103 },
    { kind: 'branch', cond: { op: 'eq', a: 0, b: 0 }, then: 'go', else: 'end' },
    { kind: 'label', name: 'go' },
    { kind: 'thread', slot: 1, entry: 'end' },
    { kind: 'jump', target: 'end' },
    { kind: 'comment', text: '注释（编译时丢弃）' },
    { kind: 'label', name: 'end' },
    { kind: 'dia', text: 'おわり。' },
  ],
};

describe('synthetic scenario (G21)', () => {
  it('compiles every node kind and decodes with expected symbols', () => {
    const bytes = compileProject(ir, 'sjis');
    expect(bytes.length).toBeGreaterThan(0);

    const decoded = decodeHcb(bytes, 'sjis');
    const syscalls = decoded.instructions
      .filter((i) => i.mnemonic === 'syscall' && i.args.kind === 'syscall')
      .map((i) => (i.args.kind === 'syscall' ? i.args.name : ''));
    const callTargets = decoded.instructions
      .filter((i) => i.mnemonic === 'call')
      .map((i) => (i.args.kind === 'x32' ? i.args.target : -1));
    const mnemonics = decoded.instructions.map((i) => i.mnemonic);

    // wait → ThreadWait
    expect(syscalls).toContain('ThreadWait');
    // thread → ThreadStart
    expect(syscalls).toContain('ThreadStart');
    // audio → AudioLoad + AudioPlay
    expect(syscalls).toContain('AudioLoad');
    expect(syscalls).toContain('AudioPlay');
    // msgset normal → call f_000349f1（恢复对话栏显示）
    expect(callTargets).toContain(0x000349f1);
    // branch → jz；jump → jmp
    expect(mnemonics).toContain('jz');
    expect(mnemonics).toContain('jmp');
  });
});
