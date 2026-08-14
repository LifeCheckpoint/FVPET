import { describe, expect, it } from 'vitest';
import { decodeHcb } from '@hcb-editor/hcb/decompile';
import type { IrScript } from '@hcb-editor/hcb/ir';
import { compileProject, compileProjectDetailed } from '../src/base/index.js';

const HEADER = { schemaVersion: 1, engine: 'fvp', game: 'sakura-moyu', nls: 'sjis' } as const;

/**
 * 模板级 golden：instantiate 展开的指令序列编译后应回解为期望的符号形态。
 * 与 roundtrip（字节级往返）互补：这里验证「语义 → 指令」的模板展开正确性。
 */
describe('template golden', () => {
  it('wait 模板展开为 push_i16 + ThreadWait syscall', () => {
    const ir: IrScript = { header: HEADER, nodes: [{ kind: 'wait', ms: 1200 }] };
    const bytes = compileProject(ir, 'sjis');
    const decoded = decodeHcb(bytes, 'sjis');

    const idx = decoded.instructions.findIndex(
      (i) => i.mnemonic === 'syscall' && i.args.kind === 'syscall' && i.args.name === 'ThreadWait',
    );
    expect(idx).toBeGreaterThan(0);
    const push = decoded.instructions[idx - 1]!;
    expect(push.mnemonic).toBe('push_i16');
    expect(push.args.kind === 'i16' && push.args.value).toBe(1200);
  });

  it('msgset normal 模板展开为两段固定函数调用', () => {
    const ir: IrScript = { header: HEADER, nodes: [{ kind: 'msgset', position: 'normal' }] };
    const bytes = compileProject(ir, 'sjis');
    const decoded = decodeHcb(bytes, 'sjis');

    const targets = decoded.instructions
      .filter((i) => i.mnemonic === 'call')
      .map((i) => (i.args.kind === 'x32' ? i.args.target : -1));
    expect(targets).toContain(0x000349f1);
    expect(targets).toContain(0x0003b797);
  });

  it('msgset boxout 模板展开为 push_i8 + neg + call f_000864f4', () => {
    const ir: IrScript = { header: HEADER, nodes: [{ kind: 'msgset', position: 'boxout' }] };
    const bytes = compileProject(ir, 'sjis');
    const decoded = decodeHcb(bytes, 'sjis');

    const negIdx = decoded.instructions.findIndex((i) => i.mnemonic === 'neg');
    expect(negIdx).toBeGreaterThan(0);
    const call = decoded.instructions.find(
      (i) => i.mnemonic === 'call' && i.args.kind === 'x32' && i.args.target === 0x000864f4,
    );
    expect(call).toBeDefined();
  });

  it('compileProjectDetailed 返回 label 绝对地址表', () => {
    const ir: IrScript = {
      header: HEADER,
      nodes: [
        { kind: 'label', name: 'start' },
        { kind: 'dia', text: 'a' },
        { kind: 'label', name: 'loop' },
        { kind: 'dia', text: 'b' },
        { kind: 'jump', target: 'loop' },
      ],
    };
    const { scriptEntry, labels } = compileProjectDetailed(ir, 'sjis');
    expect(scriptEntry).toBe(4);
    // 入口函数 prologue init_stack 占 3 字节，第一个 label 位于其后（4 + 3 = 7）。
    expect(labels.get('start')).toBe(7);
    expect(labels.get('loop')).toBeGreaterThan(7);
  });

  it('compileProjectDetailed 返回每节点地址（精确节点定位）', () => {
    const ir: IrScript = {
      header: HEADER,
      nodes: [
        { kind: 'label', name: 'start' },
        { kind: 'dia', text: 'a' },
        { kind: 'comment', text: '无代码' },
        { kind: 'dia', text: 'b' },
      ],
    };
    const { labels, nodeAddrs } = compileProjectDetailed(ir, 'sjis');
    // label 零字节：节点 0（label start）与其后节点 1（dia a）共享同一地址 7。
    expect(nodeAddrs.get(0)).toBe(7);
    expect(nodeAddrs.get(1)).toBe(7);
    // comment 无代码，不产生地址。
    expect(nodeAddrs.has(2)).toBe(false);
    // 节点 3（dia b）在节点 1 之后。
    expect(nodeAddrs.get(3)).toBeGreaterThan(7);
    // 合成节点 marker 不应泄漏进用户 labels 表。
    expect([...labels.keys()].some((name) => name.startsWith('@__node_'))).toBe(false);
  });
});
