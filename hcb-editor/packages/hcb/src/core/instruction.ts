/**
 * HCB 指令流解码 / 函数切分 / 栈效应。
 * 对应 hcb_ir_core.py 的 decode_instruction / decode_hcb / split_functions / stack_delta。
 */

import { readI8, readI16, readI32, readF32, readU8, readU16, readU32 } from './binary.js';
import { decodeCString, type Nls } from './nls.js';
import { opcodeOf } from './opcodes.js';
import { syscallById, type HcbSysdesc } from './header.js';

export type InstructionArgs =
  | { readonly kind: 'none' }
  | { readonly kind: 'init_stack'; readonly args: number; readonly locals: number }
  | { readonly kind: 'x32'; readonly target: number }
  | { readonly kind: 'syscall'; readonly id: number; readonly name: string; readonly argCount: number }
  | { readonly kind: 'i32'; readonly value: number }
  | { readonly kind: 'i16'; readonly value: number }
  | { readonly kind: 'i8'; readonly value: number }
  | { readonly kind: 'f32'; readonly value: number }
  | { readonly kind: 'string'; readonly length: number; readonly text: string; readonly textOriginal: string; readonly rawBytes: Uint8Array }
  | { readonly kind: 'u16'; readonly index: number }
  | { readonly kind: 'i8idx'; readonly index: number };

export interface Instruction {
  readonly addr: number;
  readonly opcode: number;
  readonly mnemonic: string;
  readonly args: InstructionArgs;
  readonly size: number;
  /** 原始字节副本（round-trip 原样保留用） */
  readonly rawBytes: Uint8Array;
  /** ThreadStart 前的 push_i32 立即数按函数地址处理 */
  addressRole?: 'thread_start_function_pointer';
}

export interface FunctionInfo {
  readonly name: string;
  readonly startAddr: number;
  readonly endAddr: number;
  readonly argsCount: number;
  readonly localsCount: number;
  readonly instructionAddrs: readonly number[];
}

function hex8(n: number): string {
  return n.toString(16).padStart(8, '0');
}

export function decodeInstruction(
  data: Uint8Array,
  pc: number,
  sysdesc: HcbSysdesc,
  nls: Nls,
): { inst: Instruction; nextPc: number } {
  const start = pc;
  const opcode = readU8(data, pc);
  pc += 1;
  const spec = opcodeOf(opcode);
  if (!spec) {
    throw new Error(`unknown opcode 0x${opcode.toString(16).padStart(2, '0')} at 0x${hex8(start)}`);
  }
  const mnemonic = spec.mnemonic;
  let args: InstructionArgs;

  switch (mnemonic) {
    case 'init_stack':
      args = { kind: 'init_stack', args: readI8(data, pc), locals: readI8(data, pc + 1) };
      pc += 2;
      break;
    case 'call':
    case 'jmp':
    case 'jz':
      args = { kind: 'x32', target: readU32(data, pc) };
      pc += 4;
      break;
    case 'syscall': {
      const id = readU16(data, pc);
      pc += 2;
      const sc = syscallById(sysdesc).get(id);
      args = { kind: 'syscall', id, name: sc ? sc.name : `syscall_${id}`, argCount: sc ? sc.args : 0 };
      break;
    }
    case 'push_i32':
      args = { kind: 'i32', value: readI32(data, pc) };
      pc += 4;
      break;
    case 'push_i16':
      args = { kind: 'i16', value: readI16(data, pc) };
      pc += 2;
      break;
    case 'push_i8':
      args = { kind: 'i8', value: readI8(data, pc) };
      pc += 1;
      break;
    case 'push_f32':
      args = { kind: 'f32', value: readF32(data, pc) };
      pc += 4;
      break;
    case 'push_string': {
      const strlen = readU8(data, pc);
      pc += 1;
      const rawBytes = data.subarray(pc, pc + strlen).slice();
      pc += strlen;
      const text = decodeCString(rawBytes, nls);
      args = { kind: 'string', length: strlen, text, textOriginal: text, rawBytes };
      break;
    }
    case 'push_global':
    case 'push_global_table':
    case 'pop_global':
    case 'pop_global_table':
      args = { kind: 'u16', index: readU16(data, pc) };
      pc += 2;
      break;
    case 'push_stack':
    case 'push_local_table':
    case 'pop_stack':
    case 'pop_local_table':
      args = { kind: 'i8idx', index: readI8(data, pc) };
      pc += 1;
      break;
    default:
      args = { kind: 'none' };
      break;
  }

  const inst: Instruction = {
    addr: start,
    opcode,
    mnemonic,
    args,
    size: pc - start,
    rawBytes: data.subarray(start, pc).slice(),
  };
  return { inst, nextPc: pc };
}

/** 解码代码区 [4, sysDescOffset) 的全部指令，并标记 ThreadStart 函数指针。 */
export function decodeCodeArea(
  data: Uint8Array,
  sysDescOffset: number,
  sysdesc: HcbSysdesc,
  nls: Nls,
): Instruction[] {
  const instructions: Instruction[] = [];
  let pc = 4;
  while (pc < sysDescOffset) {
    const { inst, nextPc } = decodeInstruction(data, pc, sysdesc, nls);
    if (nextPc <= pc) {
      throw new Error(`decoder did not advance at 0x${hex8(pc)}`);
    }
    instructions.push(inst);
    pc = nextPc;
  }
  for (let i = 0; i < instructions.length - 1; i += 1) {
    const inst = instructions[i]!;
    const next = instructions[i + 1]!;
    if (
      inst.mnemonic === 'push_i32' &&
      next.mnemonic === 'syscall' &&
      next.args.kind === 'syscall' &&
      next.args.name === 'ThreadStart'
    ) {
      inst.addressRole = 'thread_start_function_pointer';
    }
  }
  return instructions;
}

/** 以 init_stack 为函数起点的启发式切分。 */
export function splitFunctions(instructions: readonly Instruction[]): FunctionInfo[] {
  const funcs: FunctionInfo[] = [];
  let current:
    | {
        name: string;
        startAddr: number;
        endAddr: number;
        argsCount: number;
        localsCount: number;
        instructionAddrs: number[];
      }
    | null = null;

  for (const inst of instructions) {
    if (inst.mnemonic === 'init_stack') {
      if (current) {
        current.endAddr = inst.addr;
        funcs.push(current);
      }
      current = {
        name: `f_${hex8(inst.addr)}`,
        startAddr: inst.addr,
        endAddr: 0,
        argsCount: inst.args.kind === 'init_stack' ? inst.args.args : 0,
        localsCount: inst.args.kind === 'init_stack' ? inst.args.locals : 0,
        instructionAddrs: [inst.addr],
      };
    } else {
      if (!current) {
        current = {
          name: `f_${hex8(inst.addr)}`,
          startAddr: inst.addr,
          endAddr: 0,
          argsCount: 0,
          localsCount: 0,
          instructionAddrs: [],
        };
      }
      current.instructionAddrs.push(inst.addr);
    }
  }

  if (current) {
    const last = instructions[instructions.length - 1];
    current.endAddr = last ? last.addr + last.size : current.startAddr;
    funcs.push(current);
  }
  return funcs;
}

/** 栈效应：正=压栈，负=弹栈。call/syscall 依上下文动态计算。 */
export function stackDelta(inst: Instruction, funcsByStart?: ReadonlyMap<number, FunctionInfo>): number {
  switch (inst.mnemonic) {
    case 'nop':
    case 'init_stack':
    case 'jmp':
    case 'ret':
      return 0;
    case 'jz':
    case 'retv':
      return -1;
    case 'push_nil':
    case 'push_true':
    case 'push_i32':
    case 'push_i16':
    case 'push_i8':
    case 'push_f32':
    case 'push_string':
    case 'push_global':
    case 'push_stack':
    case 'push_top':
    case 'push_return':
      return 1;
    case 'push_global_table':
    case 'push_local_table':
      return 0;
    case 'pop_global':
    case 'pop_stack':
      return -1;
    case 'pop_global_table':
    case 'pop_local_table':
      return -2;
    case 'neg':
      return 0;
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
      return -1;
    case 'syscall':
      return -(inst.args.kind === 'syscall' ? inst.args.argCount : 0);
    case 'call': {
      const target = inst.args.kind === 'x32' ? inst.args.target : 0;
      const fn = funcsByStart?.get(target);
      return -(fn ? fn.argsCount : 0);
    }
    default:
      return 0;
  }
}
