import { describe, expect, it } from 'vitest';
import { FakeEngine } from '@hcb-editor/rfvp';

describe('FakeEngine', () => {
  it('drives a script through advance until done', () => {
    const engine = new FakeEngine();
    engine.load({ texts: [{ text: '第一句。' }, { text: '第二句。' }] });

    expect(engine.handle({ op: 'advance' })).toEqual([{ type: 'text', slot: 0, text: '第一句。' }]);
    expect(engine.handle({ op: 'advance' })).toEqual([{ type: 'text', slot: 0, text: '第二句。' }]);
    expect(engine.handle({ op: 'advance' })).toEqual([{ type: 'done' }]);
  });

  it('reads and writes G[] state', () => {
    const engine = new FakeEngine();
    engine.load({ texts: [], globals: { 103: 0 } });

    expect(engine.handle({ op: 'get_g', index: 103 })).toEqual([{ type: 'g', index: 103, value: 0 }]);
    engine.handle({ op: 'set_g', index: 103, value: 2 });
    expect(engine.handle({ op: 'get_g', index: 103 })).toEqual([{ type: 'g', index: 103, value: 2 }]);
  });

  it('replays a recorded event stream', () => {
    const engine = new FakeEngine();
    engine.load({ texts: [] });
    engine.replay([{ type: 'text', slot: 0, text: '回放。' }, { type: 'done' }]);

    expect(engine.handle({ op: 'advance' })).toEqual([{ type: 'text', slot: 0, text: '回放。' }]);
    expect(engine.handle({ op: 'advance' })).toEqual([{ type: 'done' }]);
  });
});
