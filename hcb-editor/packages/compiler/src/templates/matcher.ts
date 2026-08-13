/**
 * 模板 signature 匹配引擎（反编译识别的核心）。
 * 输入扁平指令流 + 签名模式，返回首个匹配点；供 decompile 高层把指令序列认回语义节点。
 */

import type { Instruction } from '@hcb-editor/hcb/core';
import type { AsmPattern } from './types.js';

function matchOne(inst: Instruction, pattern: AsmPattern): boolean {
  if ('mnemonic' in pattern) {
    return inst.mnemonic === pattern.mnemonic;
  }
  if ('anyOf' in pattern) {
    return pattern.anyOf.includes(inst.mnemonic);
  }
  if ('syscall' in pattern) {
    return inst.mnemonic === 'syscall' && inst.args.kind === 'syscall' && inst.args.name === pattern.syscall;
  }
  if ('syscallAny' in pattern) {
    return inst.mnemonic === 'syscall' && inst.args.kind === 'syscall' && pattern.syscallAny.includes(inst.args.name);
  }
  if ('call' in pattern) {
    return inst.mnemonic === 'call';
  }
  if ('callTo' in pattern) {
    return inst.mnemonic === 'call' && inst.args.kind === 'x32' && inst.args.target === pattern.callTo;
  }
  if ('callToAny' in pattern) {
    return (
      inst.mnemonic === 'call' && inst.args.kind === 'x32' && pattern.callToAny.includes(inst.args.target)
    );
  }
  return false;
}

function matchPatternAt(
  insts: readonly Instruction[],
  start: number,
  pattern: AsmPattern,
): { next: number; ok: boolean } {
  const inst = insts[start];
  if (!inst) {
    return { next: start, ok: false };
  }

  if ('repeat' in pattern) {
    const { pattern: inner, min = 0, max = Number.POSITIVE_INFINITY } = pattern.repeat;
    let cursor = start;
    let count = 0;
    while (cursor < insts.length && count < max && matchOne(insts[cursor]!, inner)) {
      cursor += 1;
      count += 1;
    }
    if (count < min) {
      return { next: start, ok: false };
    }
    return { next: cursor, ok: true };
  }

  if (matchOne(inst, pattern)) {
    return { next: start + 1, ok: true };
  }
  return { next: start, ok: false };
}

/**
 * 在 insts 中从 from 开始扫描，返回首个完整签名匹配的结束位置（exclusive），未匹配返回 null。
 */
export function matchSignatureFrom(
  insts: readonly Instruction[],
  signature: readonly AsmPattern[],
  from = 0,
): number | null {
  for (let i = from; i < insts.length; i += 1) {
    const end = matchSignatureAt(insts, signature, i);
    if (end !== null) {
      return end;
    }
  }
  return null;
}

/**
 * 在 insts 的位置 at 处精确匹配完整签名（at 必须是签名起点），返回结束位置（exclusive）。
 */
export function matchSignatureAt(
  insts: readonly Instruction[],
  signature: readonly AsmPattern[],
  at: number,
): number | null {
  let cursor = at;
  for (const pattern of signature) {
    const res = matchPatternAt(insts, cursor, pattern);
    if (!res.ok) {
      return null;
    }
    cursor = res.next;
  }
  return cursor;
}

export interface TemplateHit {
  readonly id: string;
  readonly count: number;
  readonly covered: number;
}

/**
 * 多模板覆盖率统计（95% 验收口径）。
 * 按 templates 传入顺序（更具体优先）在指令流上顺序扫描：
 * 每个位置尝试所有模板，命中则覆盖该区间并从结束位置继续。
 */
export function measureCoverage(
  insts: readonly Instruction[],
  templates: readonly { id: string; signature: readonly AsmPattern[] }[],
): { hits: TemplateHit[]; total: number; covered: number; rate: number } {
  const hits = new Map<string, { count: number; covered: number }>();
  const coveredSet = new Set<number>();
  let cursor = 0;
  while (cursor < insts.length) {
    let matched = false;
    for (const t of templates) {
      const end = matchSignatureAt(insts, t.signature, cursor);
      if (end !== null && end > cursor) {
        const h = hits.get(t.id) ?? { count: 0, covered: 0 };
        h.count += 1;
        h.covered += end - cursor;
        hits.set(t.id, h);
        for (let i = cursor; i < end; i += 1) {
          coveredSet.add(i);
        }
        cursor = end;
        matched = true;
        break;
      }
    }
    if (!matched) {
      cursor += 1;
    }
  }
  return {
    hits: [...hits.entries()].map(([id, h]) => ({ id, count: h.count, covered: h.covered })),
    total: insts.length,
    covered: coveredSet.size,
    rate: insts.length === 0 ? 0 : coveredSet.size / insts.length,
  };
}
