import { describe, expect, it } from 'vitest';
import {
  audioTemplate,
  bsfadeTemplate,
  eyecatchTemplate,
  whiteTemplate,
} from '@hcb-editor/compiler/templates';
import type { TemplateCtx } from '@hcb-editor/compiler/templates';

const ctx: TemplateCtx = {
  nls: 'sjis',
  tables: { characters: {}, backgrounds: {}, globals: {} },
};

describe('新增演出节点模板（对照 hcb_build.py）', () => {
  it('eyecatch 编译为 5×push_nil + call f_00036e7b', () => {
    const [block] = eyecatchTemplate.instantiate({ kind: 'eyecatch' }, ctx);
    expect(block!.instructions).toEqual([
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'call', target: 'f_00036e7b' },
    ]);
  });

  it('bsfade 编译为 2×push_nil + call f_0000baa9', () => {
    const [block] = bsfadeTemplate.instantiate({ kind: 'bsfade' }, ctx);
    expect(block!.instructions).toEqual([
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'call', target: 'f_0000baa9' },
    ]);
  });

  it('white 编译为 call f_00005467 开头、call f_0004115a 结尾', () => {
    const [block] = whiteTemplate.instantiate({ kind: 'white' }, ctx);
    const ins = block!.instructions;
    expect(ins[0]).toEqual({ op: 'call', target: 'f_00005467' });
    expect(ins[ins.length - 1]).toEqual({ op: 'call', target: 'f_0004115a' });
  });

  it('bgm stop 编译为 push_nil + call f_00040695', () => {
    const [block] = audioTemplate.instantiate(
      { kind: 'audio', type: 'bgm', channelOrNum: 0, action: 'stop' },
      ctx,
    );
    expect(block!.instructions).toEqual([
      { op: 'push_nil' },
      { op: 'call', target: 'f_00040695' },
    ]);
  });

  it('se loop 与 stop 编译为 call f_0003fc08 序列', () => {
    const loop = audioTemplate.instantiate(
      { kind: 'audio', type: 'se', channelOrNum: 168, loop: true, time: 1000 },
      ctx,
    );
    expect(loop[0]!.instructions).toEqual([
      { op: 'push_i16', value: 168 },
      { op: 'push_i8', value: 1 },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'push_i16', value: 1000 },
      { op: 'call', target: 'f_0003fc08' },
    ]);

    const stop = audioTemplate.instantiate(
      { kind: 'audio', type: 'se', channelOrNum: 168, action: 'stop', time: 3000 },
      ctx,
    );
    expect(stop[0]!.instructions).toEqual([
      { op: 'push_i16', value: 168 },
      { op: 'push_i16', value: 3000 },
      { op: 'push_i8', value: 0 },
      { op: 'push_nil' },
      { op: 'push_nil' },
      { op: 'call', target: 'f_0003fc08' },
    ]);
  });
});
