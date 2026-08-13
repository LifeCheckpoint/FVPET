/**
 * assemble pass：AsmBlock[] → 扁平 Instruction[]（符号解析）。
 * 两遍：
 *   1. layout：为每个 label 分配代码地址（从 4 开始），累加每条符号指令的字节大小。
 *   2. 展开：AsmInstruction → Instruction，解析 call/jmp/jz 目标、syscall name → id、字符串内联。
 */

import {
  ByteWriter,
  decodeCString,
  encodeCString,
  hexOfMnemonic,
  readI8,
  readI16,
  readI32,
  readF32,
  readU16,
  readU32,
  type HcbSysdesc,
  type Instruction,
  type InstructionArgs,
  type Nls,
} from '@hcb-editor/hcb/core';
import type { AsmBlock, AsmInstruction } from '../templates/types.js';

function asmSize(ins: AsmInstruction, nls: Nls): number {
  switch (ins.op) {
    case 'push_string':
      return 2 + encodeCString(ins.text, nls).length;
    case 'init_stack':
    case 'syscall':
    case 'push_global':
    case 'pop_global':
    case 'push_global_table':
    case 'pop_global_table':
    case 'push_i16':
      return 3;
    case 'call':
    case 'jmp':
    case 'jz':
    case 'push_i32':
    case 'push_f32':
    case 'push_thread_entry':
      return 5;
    case 'push_i8':
    case 'push_stack':
    case 'pop_stack':
    case 'push_local_table':
    case 'pop_local_table':
      return 2;
    default:
      return 1;
  }
}

function opcodeOfMnemonic(mnemonic: string): number {
  const hex = hexOfMnemonic(mnemonic);
  if (hex === undefined) {
    throw new Error(`unknown mnemonic: ${mnemonic}`);
  }
  return hex;
}

function resolveTarget(target: string, labelAddr: ReadonlyMap<string, number>): number {
  const label = labelAddr.get(target);
  if (label !== undefined) {
    return label;
  }
  if (target.startsWith('f_')) {
    return Number.parseInt(target.slice(2), 16);
  }
  if (target.startsWith('@')) {
    throw new Error(`unresolved internal label: ${target}`);
  }
  return Number.parseInt(target, 16);
}

function decodeArgs(mnemonic: string, bytes: Uint8Array, nls: Nls): InstructionArgs {
  switch (mnemonic) {
    case 'init_stack':
      return { kind: 'init_stack', args: readI8(bytes, 1), locals: readI8(bytes, 2) };
    case 'call':
    case 'jmp':
    case 'jz':
      return { kind: 'x32', target: readU32(bytes, 1) };
    case 'syscall':
      return { kind: 'syscall', id: readU16(bytes, 1), name: '', argCount: 0 };
    case 'push_i32':
      return { kind: 'i32', value: readI32(bytes, 1) };
    case 'push_i16':
      return { kind: 'i16', value: readI16(bytes, 1) };
    case 'push_i8':
      return { kind: 'i8', value: readI8(bytes, 1) };
    case 'push_f32':
      return { kind: 'f32', value: readF32(bytes, 1) };
    case 'push_string': {
      const len = bytes[1] ?? 0;
      const raw = bytes.subarray(2, 2 + len).slice();
      const text = decodeCString(raw, nls);
      return { kind: 'string', length: len, text, textOriginal: text, rawBytes: raw };
    }
    case 'push_global':
    case 'pop_global':
    case 'push_global_table':
    case 'pop_global_table':
      return { kind: 'u16', index: readU16(bytes, 1) };
    case 'push_stack':
    case 'pop_stack':
    case 'push_local_table':
    case 'pop_local_table':
      return { kind: 'i8idx', index: readI8(bytes, 1) };
    default:
      return { kind: 'none' };
  }
}

function expandInstruction(
  ins: AsmInstruction,
  labelAddr: ReadonlyMap<string, number>,
  syscallByName: ReadonlyMap<string, number>,
  nls: Nls,
): Instruction {
  const w = new ByteWriter();
  let addressRole: 'label_ref' | undefined;
  switch (ins.op) {
    case 'init_stack':
      w.u8(opcodeOfMnemonic('init_stack')).i8(ins.args).i8(ins.locals);
      break;
    case 'call':
    case 'jmp':
    case 'jz':
      // 目标是脚本内部 label（相对偏移）时标记，编码阶段据此重定位；
      // 目标是 f_/绝对函数地址（底座库函数）时不标记，编码阶段原样写出。
      if (labelAddr.has(ins.target)) {
        addressRole = 'label_ref';
      }
      w.u8(opcodeOfMnemonic(ins.op)).u32(resolveTarget(ins.target, labelAddr));
      break;
    case 'syscall': {
      const id = syscallByName.get(ins.name);
      if (id === undefined) {
        throw new Error(`unknown syscall: ${ins.name}`);
      }
      w.u8(opcodeOfMnemonic('syscall')).u16(id);
      break;
    }
    case 'ret':
    case 'retv':
    case 'push_nil':
    case 'push_true':
    case 'push_top':
    case 'push_return':
    case 'neg':
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod':
    case 'bit_test':
    case 'and':
    case 'or':
    case 'set_e':
    case 'set_ne':
    case 'set_g':
    case 'set_ge':
    case 'set_l':
    case 'set_le':
      w.u8(opcodeOfMnemonic(ins.op));
      break;
    case 'push_i32':
      w.u8(opcodeOfMnemonic('push_i32')).i32(ins.value);
      break;
    case 'push_thread_entry': {
      // ThreadStart 前的函数指针：解析 label 地址并标记，encode 阶段按旧地址重映射。
      const addr = resolveTarget(ins.target, labelAddr);
      w.u8(opcodeOfMnemonic('push_i32')).u32(addr);
      const bytes = w.toBytes();
      return {
        addr: 0,
        opcode: bytes[0] ?? 0,
        mnemonic: 'push_i32',
        args: { kind: 'i32', value: addr },
        size: bytes.length,
        rawBytes: bytes,
        addressRole: 'thread_start_function_pointer',
      };
    }
    case 'push_i16':
      w.u8(opcodeOfMnemonic('push_i16')).i16(ins.value);
      break;
    case 'push_i8':
      w.u8(opcodeOfMnemonic('push_i8')).i8(ins.value);
      break;
    case 'push_f32':
      w.u8(opcodeOfMnemonic('push_f32')).f32(ins.value);
      break;
    case 'push_string': {
      const raw = encodeCString(ins.text, nls);
      w.u8(opcodeOfMnemonic('push_string')).u8(raw.length).bytes(raw);
      break;
    }
    case 'push_global':
    case 'pop_global':
    case 'push_global_table':
    case 'pop_global_table':
      w.u8(opcodeOfMnemonic(ins.op)).u16(ins.index);
      break;
    case 'push_stack':
    case 'pop_stack':
    case 'push_local_table':
    case 'pop_local_table':
      w.u8(opcodeOfMnemonic(ins.op)).i8(ins.index);
      break;
  }

  const bytes = w.toBytes();
  return {
    addr: 0, // 由 layout 阶段回填
    opcode: bytes[0] ?? 0,
    mnemonic: ins.op,
    args: decodeArgs(ins.op, bytes, nls),
    size: bytes.length,
    rawBytes: bytes,
    ...(addressRole !== undefined ? { addressRole } : {}),
  };
}

export function assemble(blocks: readonly AsmBlock[], sysdesc: HcbSysdesc, nls: Nls): Instruction[] {
  // 第一遍：label 地址分配
  const labelAddr = new Map<string, number>();
  let addr = 4;
  for (const block of blocks) {
    if (block.label !== undefined) {
      labelAddr.set(block.label, addr);
    }
    for (const ins of block.instructions) {
      addr += asmSize(ins, nls);
    }
  }

  const syscallByName = new Map(sysdesc.syscalls.map((s) => [s.name, s.id]));

  // 第二遍：展开并回填 addr
  const out: Instruction[] = [];
  let cur = 4;
  for (const block of blocks) {
    for (const ins of block.instructions) {
      const inst = expandInstruction(ins, labelAddr, syscallByName, nls);
      out.push({ ...inst, addr: cur });
      cur += inst.size;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// raw 逃生舱：flat item（指令 | raw 字节块），支持字节透传 + 重定位。
// ---------------------------------------------------------------------------

export interface ResolvedRawRelocation {
  readonly offset: number;
  readonly target: number;
}

export type FlatItem =
  | { readonly kind: 'inst'; readonly inst: Instruction }
  | { readonly kind: 'raw'; readonly bytes: Uint8Array; readonly relocations: readonly ResolvedRawRelocation[] };

function resolveRawTarget(target: string, labelAddr: ReadonlyMap<string, number>): number {
  const label = labelAddr.get(target);
  if (label !== undefined) {
    return label;
  }
  if (target.startsWith('f_')) {
    return Number.parseInt(target.slice(2), 16);
  }
  if (target.startsWith('@')) {
    throw new Error(`无法解析的 raw 重定位目标：${target}`);
  }
  const num = Number.parseInt(target, 16);
  if (!Number.isFinite(num)) {
    throw new Error(`无法解析的 raw 重定位目标：${target}`);
  }
  return num;
}

/** assembleFlat 的结果 + label 地址表（label → 相对代码区偏移，从 4 起算）。 */
export interface AssembleFlatResult {
  readonly items: FlatItem[];
  readonly labels: ReadonlyMap<string, number>;
}

/** 与 assemble 相同，但保留 raw 块（字节透传），并把 raw 重定位目标解析为数值。 */
export function assembleFlat(blocks: readonly AsmBlock[], sysdesc: HcbSysdesc, nls: Nls): FlatItem[] {
  return assembleFlatWithLabels(blocks, sysdesc, nls).items;
}

/** assembleFlat + 返回 label → 相对偏移表（供 label 断点跳转用）。 */
export function assembleFlatWithLabels(
  blocks: readonly AsmBlock[],
  sysdesc: HcbSysdesc,
  nls: Nls,
): AssembleFlatResult {
  const labelAddr = new Map<string, number>();
  let addr = 4;
  for (const block of blocks) {
    if (block.label !== undefined) {
      labelAddr.set(block.label, addr);
    }
    for (const ins of block.instructions) {
      addr += asmSize(ins, nls);
    }
    if (block.raw) {
      addr += block.raw.bytes.length;
    }
  }

  const syscallByName = new Map(sysdesc.syscalls.map((s) => [s.name, s.id]));
  const out: FlatItem[] = [];
  let cur = 4;
  for (const block of blocks) {
    for (const ins of block.instructions) {
      const inst = expandInstruction(ins, labelAddr, syscallByName, nls);
      out.push({ kind: 'inst', inst: { ...inst, addr: cur } });
      cur += inst.size;
    }
    if (block.raw) {
      const relocations = block.raw.relocations
        .filter((r) => r.kind !== 'string_ref')
        .map((r) => ({ offset: r.offset, target: resolveRawTarget(r.target, labelAddr) }));
      out.push({ kind: 'raw', bytes: block.raw.bytes, relocations });
      cur += block.raw.bytes.length;
    }
  }
  return { items: out, labels: labelAddr };
}
