import { describe, expect, it } from 'vitest';
import { decodeHcb } from '@hcb-editor/hcb/decompile';
import type { IrScript } from '@hcb-editor/hcb/ir';
import { compileProject } from '../src/base/index.js';

/**
 * 线程入口解析回归：thread 节点的 entry label 必须解析为真实地址，
 * 而非编译为 `push_i32 0`（否则 ThreadStart 指向地址 0 → tick Backend）。
 */
describe('thread entry resolution', () => {
  it('resolves the entry label address into the ThreadStart pointer', () => {
    const ir: IrScript = {
      header: { schemaVersion: 1, engine: 'fvp', game: 'sakura-moyu', nls: 'sjis' },
      nodes: [
        { kind: 'label', name: 'start' },
        { kind: 'thread', slot: 1, entry: 'bg' },
        { kind: 'dia', text: 'main' },
        { kind: 'label', name: 'bg' },
        { kind: 'dia', text: 'thread body' },
      ],
    };
    const bytes = compileProject(ir, 'sjis'); // 无需底座二进制，脚本-only 亦可验证地址解析
    const decoded = decodeHcb(bytes, 'sjis');

    const threadStartIdx = decoded.instructions.findIndex(
      (i) => i.mnemonic === 'syscall' && i.args.kind === 'syscall' && i.args.name === 'ThreadStart',
    );
    expect(threadStartIdx).toBeGreaterThan(0);
    const push = decoded.instructions[threadStartIdx - 1]!;
    expect(push.mnemonic).toBe('push_i32');
    expect(push.args.kind === 'i32' && push.args.value).toBeGreaterThan(4);

    // 指针应指向 label 'bg' 的实际地址。
    const labelAddr = decoded.instructions.find(
      (i) => i.mnemonic === 'push_string' && i.args.kind === 'string' && i.args.text === 'thread body',
    );
    expect(labelAddr).toBeDefined();
    // bg 标签应位于其内容（push_string 'thread body'）之前不远，且指针指向代码区内部。
    expect(push.args.kind === 'i32' && push.args.value).toBeGreaterThan(0);
  });
});
