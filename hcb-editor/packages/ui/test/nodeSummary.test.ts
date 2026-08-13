import { describe, expect, it } from 'vitest';
import { summarizeNode } from '@hcb-editor/ui';
import { branchNode, diaNode, labelNode, speakNode } from '@hcb-editor/editor';

describe('summarizeNode', () => {
  it('summarizes a speak node as speaker + truncated text', () => {
    const summary = summarizeNode(speakNode('クロ', '今天的风很大。'));
    expect(summary.primary).toBe('クロ');
    expect(summary.secondary).toBe('今天的风很大。');
  });

  it('uses the unknown-speaker placeholder for empty speaker', () => {
    const summary = summarizeNode(speakNode('', '你好'));
    expect(summary.primary).toBe('？？？');
  });

  it('summarizes a label node with its name', () => {
    const summary = summarizeNode(labelNode('start'));
    expect(summary.primary).toBe('start');
  });

  it('summarizes a branch node via cond rendering', () => {
    const summary = summarizeNode(branchNode({ op: 'global_eq', global: 103, value: 1 }, 'yes', 'no'));
    expect(summary.primary).toBe('G[103] == 1');
  });

  it('summarizes a dia node and truncates long text', () => {
    const summary = summarizeNode(diaNode('这是一段非常长的旁白文本，应该被截断以保持卡片紧凑。'));
    expect(summary.primary.length).toBeLessThanOrEqual(26);
  });
});
