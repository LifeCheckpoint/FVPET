/**
 * CFG 构建（基本块 + 前驱/后继 + 近似栈深度）。
 * 对应 hcb_ir_core.py 的 block_term / build_cfg_for_insts。
 */

import { stackDelta, type FunctionInfo, type Instruction } from '../core/instruction.js';

export type BlockTerm = 'jmp' | 'jz' | 'ret' | 'retv' | 'fallthrough';

export interface BasicBlock {
  id: number;
  start: number;
  end: number;
  instructionAddrs: number[];
  preds: number[];
  succs: number[];
  term: BlockTerm;
  inDepth: number;
  outDepth: number;
  isLoopHeader: boolean;
}

export interface FunctionCfg {
  function: string;
  startAddr: number;
  blocks: BasicBlock[];
  maxDepth: number;
}

function blockTerm(inst: Instruction | undefined): BlockTerm {
  if (!inst) {
    return 'fallthrough';
  }
  switch (inst.mnemonic) {
    case 'jmp':
      return 'jmp';
    case 'jz':
      return 'jz';
    case 'ret':
      return 'ret';
    case 'retv':
      return 'retv';
    default:
      return 'fallthrough';
  }
}

export function buildCfg(
  func: FunctionInfo,
  insts: readonly Instruction[],
  funcsByStart: ReadonlyMap<number, FunctionInfo>,
): FunctionCfg {
  if (insts.length === 0) {
    return { function: func.name, startAddr: func.startAddr, blocks: [], maxDepth: 0 };
  }

  const addrToIdx = new Map<number, number>();
  insts.forEach((inst, i) => addrToIdx.set(inst.addr, i));

  // leaders
  const leaderSet = new Set<number>([insts[0]!.addr]);
  for (let i = 0; i < insts.length; i += 1) {
    const inst = insts[i]!;
    const m = inst.mnemonic;
    if (m === 'jmp' || m === 'jz') {
      const target = inst.args.kind === 'x32' ? inst.args.target : 0;
      if (addrToIdx.has(target)) {
        leaderSet.add(target);
      }
      if (i + 1 < insts.length) {
        leaderSet.add(insts[i + 1]!.addr);
      }
    } else if ((m === 'ret' || m === 'retv') && i + 1 < insts.length) {
      leaderSet.add(insts[i + 1]!.addr);
    }
  }
  const leaders = [...leaderSet].sort((a, b) => a - b);

  // split into blocks
  const blocks: BasicBlock[] = [];
  const addrToBlock = new Map<number, number>();
  for (let bid = 0; bid < leaders.length; bid += 1) {
    const start = leaders[bid]!;
    const nextLeader =
      bid + 1 < leaders.length ? leaders[bid + 1]! : insts[insts.length - 1]!.addr + insts[insts.length - 1]!.size;
    const indices: number[] = [];
    for (let i = 0; i < insts.length; i += 1) {
      const a = insts[i]!.addr;
      if (a >= start && a < nextLeader) {
        indices.push(i);
      }
    }
    if (indices.length === 0) {
      continue;
    }
    for (const i of indices) {
      addrToBlock.set(insts[i]!.addr, blocks.length);
    }
    const last = insts[indices[indices.length - 1]!]!;
    blocks.push({
      id: blocks.length,
      start,
      end: last.addr + last.size,
      instructionAddrs: indices.map((i) => insts[i]!.addr),
      preds: [],
      succs: [],
      term: blockTerm(last),
      inDepth: 0,
      outDepth: 0,
      isLoopHeader: false,
    });
  }

  // successors
  for (const b of blocks) {
    const lastAddr = b.instructionAddrs[b.instructionAddrs.length - 1];
    const lastIdx = lastAddr !== undefined ? addrToIdx.get(lastAddr) : undefined;
    const inst = lastIdx !== undefined ? insts[lastIdx] : undefined;
    if (!inst) {
      continue;
    }
    const m = inst.mnemonic;
    if (m === 'jmp') {
      const tid = inst.args.kind === 'x32' ? addrToBlock.get(inst.args.target) : undefined;
      if (tid !== undefined) {
        b.succs.push(tid);
      }
    } else if (m === 'jz') {
      const tid = inst.args.kind === 'x32' ? addrToBlock.get(inst.args.target) : undefined;
      if (tid !== undefined) {
        b.succs.push(tid);
      }
      const idx = addrToIdx.get(inst.addr) ?? 0;
      if (idx + 1 < insts.length) {
        const fid = addrToBlock.get(insts[idx + 1]!.addr);
        if (fid !== undefined && !b.succs.includes(fid)) {
          b.succs.push(fid);
        }
      }
    } else if (m !== 'ret' && m !== 'retv') {
      const idx = addrToIdx.get(inst.addr) ?? 0;
      if (idx + 1 < insts.length) {
        const fid = addrToBlock.get(insts[idx + 1]!.addr);
        if (fid !== undefined) {
          b.succs.push(fid);
        }
      }
    }
  }

  // predecessors
  for (const b of blocks) {
    for (const s of b.succs) {
      const target = blocks[s];
      if (target) {
        target.preds.push(b.id);
      }
    }
  }

  // approximate stack depth worklist（带迭代上限，防无界环导致死循环）
  const depths = new Map<number, number>([[0, 0]]);
  const queue: number[] = blocks.length > 0 ? [0] : [];
  let maxDepth = 0;
  let iterations = 0;
  const maxIterations = Math.max(64, blocks.length * 64);
  while (queue.length > 0 && iterations < maxIterations) {
    iterations += 1;
    const bid = queue.shift()!;
    let d = depths.get(bid) ?? 0;
    const b = blocks[bid]!;
    for (const a of b.instructionAddrs) {
      const idx = addrToIdx.get(a);
      if (idx !== undefined) {
        d += stackDelta(insts[idx]!, funcsByStart);
      }
      if (d < 0) {
        d = 0;
      }
      maxDepth = Math.max(maxDepth, d);
    }
    b.inDepth = depths.get(bid) ?? 0;
    b.outDepth = d;
    for (const sid of b.succs) {
      const nd = Math.max(depths.get(sid) ?? 0, d);
      if (!depths.has(sid) || nd !== depths.get(sid)) {
        depths.set(sid, nd);
        queue.push(sid);
      }
    }
  }

  // loop header detection（后向边）
  for (const b of blocks) {
    for (const sid of b.succs) {
      const target = blocks[sid];
      if (target && target.start < b.start) {
        target.isLoopHeader = true;
      }
    }
  }

  return { function: func.name, startAddr: func.startAddr, blocks, maxDepth };
}
