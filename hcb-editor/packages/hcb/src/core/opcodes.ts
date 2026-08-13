/**
 * HCB opcode 表（数据）。
 * 三源交叉核对：hcb_ir_core.py OPCODES、fvp_analysis 规范文档 §6.3、rfvp 主引擎 script/opcode.rs。
 *
 * 关键裁定：0x25 在 rfvp 枚举名为 SetLE 但行为是 `>=`（canonical: set_ge）；
 *            0x27 在 rfvp 枚举名为 SetGE 但行为是 `<=`（canonical: set_le）。
 * 本表以修正后的 canonical mnemonic 为准；hcb2lua_decompiler 的 opcode.rs 未做该修正，勿照抄。
 */

export type OperandKind =
  | 'null' // 无操作数
  | 'i8' // 1 字节有符号
  | 'i16' // 2 字节（语义常作索引/编号）
  | 'i32' // 4 字节有符号
  | 'f32' // 4 字节浮点
  | 'x32' // 4 字节地址/无符号
  | 'u16' // 2 字节无符号索引（push_global / pop_global 等）
  | 'i8i8' // 两个连续 i8（init_stack）
  | 'string'; // u8 len + bytes（含 NUL）

export interface OpcodeSpec {
  readonly mnemonic: string;
  readonly operands: OperandKind;
  /**
   * 固定栈效应：正=压栈，负=弹栈。
   * call / syscall 记 0，其精确值由上下文（函数签名 / 导入表 arg_count）动态计算，
   * 由 validate pass 单独处理。
   */
  readonly stackDelta: number;
}

export const OPCODES = {
  0x00: { mnemonic: 'nop', operands: 'null', stackDelta: 0 },
  0x01: { mnemonic: 'init_stack', operands: 'i8i8', stackDelta: 0 },
  0x02: { mnemonic: 'call', operands: 'x32', stackDelta: 0 },
  0x03: { mnemonic: 'syscall', operands: 'i16', stackDelta: 0 },
  0x04: { mnemonic: 'ret', operands: 'null', stackDelta: 0 },
  0x05: { mnemonic: 'retv', operands: 'null', stackDelta: -1 },
  0x06: { mnemonic: 'jmp', operands: 'x32', stackDelta: 0 },
  0x07: { mnemonic: 'jz', operands: 'x32', stackDelta: -1 },
  0x08: { mnemonic: 'push_nil', operands: 'null', stackDelta: 1 },
  0x09: { mnemonic: 'push_true', operands: 'null', stackDelta: 1 },
  0x0a: { mnemonic: 'push_i32', operands: 'i32', stackDelta: 1 },
  0x0b: { mnemonic: 'push_i16', operands: 'i16', stackDelta: 1 },
  0x0c: { mnemonic: 'push_i8', operands: 'i8', stackDelta: 1 },
  0x0d: { mnemonic: 'push_f32', operands: 'f32', stackDelta: 1 },
  0x0e: { mnemonic: 'push_string', operands: 'string', stackDelta: 1 },
  0x0f: { mnemonic: 'push_global', operands: 'u16', stackDelta: 1 },
  0x10: { mnemonic: 'push_stack', operands: 'i8', stackDelta: 1 },
  0x11: { mnemonic: 'push_global_table', operands: 'u16', stackDelta: 0 },
  0x12: { mnemonic: 'push_local_table', operands: 'i8', stackDelta: 0 },
  0x13: { mnemonic: 'push_top', operands: 'null', stackDelta: 1 },
  0x14: { mnemonic: 'push_return', operands: 'null', stackDelta: 1 },
  0x15: { mnemonic: 'pop_global', operands: 'u16', stackDelta: -1 },
  0x16: { mnemonic: 'pop_stack', operands: 'i8', stackDelta: -1 },
  0x17: { mnemonic: 'pop_global_table', operands: 'u16', stackDelta: -2 },
  0x18: { mnemonic: 'pop_local_table', operands: 'i8', stackDelta: -2 },
  0x19: { mnemonic: 'neg', operands: 'null', stackDelta: 0 },
  0x1a: { mnemonic: 'add', operands: 'null', stackDelta: -1 },
  0x1b: { mnemonic: 'sub', operands: 'null', stackDelta: -1 },
  0x1c: { mnemonic: 'mul', operands: 'null', stackDelta: -1 },
  0x1d: { mnemonic: 'div', operands: 'null', stackDelta: -1 },
  0x1e: { mnemonic: 'mod', operands: 'null', stackDelta: -1 },
  0x1f: { mnemonic: 'bit_test', operands: 'null', stackDelta: -1 },
  0x20: { mnemonic: 'and', operands: 'null', stackDelta: -1 },
  0x21: { mnemonic: 'or', operands: 'null', stackDelta: -1 },
  0x22: { mnemonic: 'set_e', operands: 'null', stackDelta: -1 },
  0x23: { mnemonic: 'set_ne', operands: 'null', stackDelta: -1 },
  0x24: { mnemonic: 'set_g', operands: 'null', stackDelta: -1 },
  0x25: { mnemonic: 'set_ge', operands: 'null', stackDelta: -1 },
  0x26: { mnemonic: 'set_l', operands: 'null', stackDelta: -1 },
  0x27: { mnemonic: 'set_le', operands: 'null', stackDelta: -1 },
} as const satisfies Record<number, OpcodeSpec>;

export type OpcodeHex = keyof typeof OPCODES;

export function opcodeOf(hex: number): OpcodeSpec | undefined {
  return (OPCODES as Record<number, OpcodeSpec>)[hex];
}

const MNEMONIC_TO_HEX = new Map<string, number>();
for (const [hexStr, spec] of Object.entries(OPCODES)) {
  MNEMONIC_TO_HEX.set(spec.mnemonic, Number(hexStr));
}

export function hexOfMnemonic(mnemonic: string): number | undefined {
  return MNEMONIC_TO_HEX.get(mnemonic);
}

/** 操作数定长部分字节数；`string` 变长，由指令流解析决定，返回 -1。 */
export function operandSize(operands: OperandKind): number {
  switch (operands) {
    case 'null':
      return 0;
    case 'i8':
      return 1;
    case 'i16':
    case 'u16':
      return 2;
    case 'i32':
    case 'x32':
    case 'f32':
      return 4;
    case 'i8i8':
      return 2;
    case 'string':
      return -1;
  }
}
