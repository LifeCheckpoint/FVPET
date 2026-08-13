/**
 * encode pass：扁平指令流 → HCB 二进制（layout + relocate + encode 融合）。
 * 对应 hcb_ir_core.py 的 assemble_ir / encode_instruction / instruction_size_for_encode。
 */

import {
  ByteWriter,
  operandSize,
  opcodeOf,
  rawOrEncoded,
  serializeSysdesc,
  type HcbSysdesc,
  type Instruction,
  type Nls,
} from '@hcb-editor/hcb/core';
import type { FlatItem } from './assemble.js';

function instructionSizeForEncode(inst: Instruction, nls: Nls): number {
  if (inst.mnemonic === 'push_string' && inst.args.kind === 'string') {
    const raw = rawOrEncoded(inst.args.text, inst.args.textOriginal, inst.args.rawBytes, nls);
    return 2 + raw.length;
  }
  const kind = opcodeOf(inst.opcode)?.operands ?? 'null';
  return 1 + Math.max(0, operandSize(kind));
}

export function encodeInstruction(inst: Instruction, oldToNew: ReadonlyMap<number, number>, nls: Nls): Uint8Array {
  const w = new ByteWriter();
  w.u8(inst.opcode);
  const a = inst.args;
  switch (inst.mnemonic) {
    case 'init_stack':
      if (a.kind === 'init_stack') {
        w.i8(a.args).i8(a.locals);
      }
      break;
    case 'call':
    case 'jmp':
    case 'jz':
      if (a.kind === 'x32') {
        w.u32(oldToNew.get(a.target) ?? a.target);
      }
      break;
    case 'syscall':
      if (a.kind === 'syscall') {
        w.u16(a.id);
      }
      break;
    case 'push_i32':
      if (a.kind === 'i32') {
        let v = a.value;
        if (inst.addressRole === 'thread_start_function_pointer') {
          v = oldToNew.get(v) ?? v;
        }
        w.i32(v);
      }
      break;
    case 'push_i16':
      if (a.kind === 'i16') {
        w.i16(a.value);
      }
      break;
    case 'push_i8':
      if (a.kind === 'i8') {
        w.i8(a.value);
      }
      break;
    case 'push_f32':
      if (a.kind === 'f32') {
        w.f32(a.value);
      }
      break;
    case 'push_string':
      if (a.kind === 'string') {
        const raw = rawOrEncoded(a.text, a.textOriginal, a.rawBytes, nls);
        w.u8(raw.length).bytes(raw);
      }
      break;
    case 'push_global':
    case 'push_global_table':
    case 'pop_global':
    case 'pop_global_table':
      if (a.kind === 'u16') {
        w.u16(a.index);
      }
      break;
    case 'push_stack':
    case 'push_local_table':
    case 'pop_stack':
    case 'pop_local_table':
      if (a.kind === 'i8idx') {
        w.i8(a.index);
      }
      break;
    default:
      break;
  }
  return w.toBytes();
}

export function encodeFromFlat(
  instructions: readonly Instruction[],
  sysdesc: HcbSysdesc,
  nls: Nls,
): Uint8Array {
  // layout：old -> new 地址映射
  const oldToNew = new Map<number, number>();
  let addr = 4;
  for (const inst of instructions) {
    oldToNew.set(inst.addr, addr);
    addr += instructionSizeForEncode(inst, nls);
  }

  // encode code area（relocate 内联完成）
  const code = new ByteWriter();
  for (const inst of instructions) {
    code.bytes(encodeInstruction(inst, oldToNew, nls));
  }
  const sysDescOffset = 4 + code.length;

  // sysdesc（entry_point 重定位）
  const entryPoint = oldToNew.get(sysdesc.entryPoint) ?? sysdesc.entryPoint;
  const relocatedSysdesc: HcbSysdesc = { ...sysdesc, entryPoint };
  const sysdescBytes = serializeSysdesc(relocatedSysdesc, nls);

  const out = new ByteWriter();
  out.u32(sysDescOffset).bytes(code.toBytes()).bytes(sysdescBytes);
  return out.toBytes();
}

function writeU32Le(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

/** 仅编码代码区（无头部/sysdesc），布局从 startAddr 开始。 */
export function encodeFlatItemsCode(items: readonly FlatItem[], startAddr: number, nls: Nls): Uint8Array {
  const oldToNew = new Map<number, number>();
  let addr = startAddr;
  for (const item of items) {
    if (item.kind === 'inst') {
      oldToNew.set(item.inst.addr, addr);
      addr += instructionSizeForEncode(item.inst, nls);
    } else {
      addr += item.bytes.length;
    }
  }

  const code = new ByteWriter();
  for (const item of items) {
    if (item.kind === 'inst') {
      code.bytes(encodeInstruction(item.inst, oldToNew, nls));
    } else {
      const bytes = item.bytes.slice();
      for (const rel of item.relocations) {
        const targetNew = oldToNew.get(rel.target) ?? rel.target;
        writeU32Le(bytes, rel.offset, targetNew);
      }
      code.bytes(bytes);
    }
  }
  return code.toBytes();
}

/** 与 encodeFromFlat 对应，但支持 raw 字节块透传 + 重定位（compile 路径）。 */
export function encodeFlatItems(
  items: readonly FlatItem[],
  sysdesc: HcbSysdesc,
  nls: Nls,
): Uint8Array {
  const code = encodeFlatItemsCode(items, 4, nls);

  const sysDescOffset = 4 + code.length;
  const entryPoint = sysdesc.entryPoint;
  const relocatedSysdesc: HcbSysdesc = { ...sysdesc, entryPoint };
  const sysdescBytes = serializeSysdesc(relocatedSysdesc, nls);

  const out = new ByteWriter();
  out.u32(sysDescOffset).bytes(code).bytes(sysdescBytes);
  return out.toBytes();
}
