import { readFileSync } from 'node:fs';

const path = process.argv[2];
const data = new Uint8Array(readFileSync(path));
console.log('file size', data.length);
const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
const sysDescOffset = dv.getUint32(0, true);
console.log('sys_desc_offset', sysDescOffset, 'valid=', sysDescOffset <= data.length && sysDescOffset >= 4);

// 线性解码指令，打印前 30 条
let pc = 4;
let count = 0;
while (pc < sysDescOffset && count < 30) {
  const op = data[pc];
  console.log(`pc=${pc.toString(16)} op=${op.toString(16)}`);
  // 简单推进（仅诊断用）：跳过已知定长操作数
  const sizes = {
    0x00: 1, 0x04: 1, 0x05: 1, 0x08: 1, 0x09: 1, 0x13: 1, 0x14: 1,
    0x19: 1, 0x1a: 1, 0x1b: 1, 0x1c: 1, 0x1d: 1, 0x1e: 1, 0x1f: 1,
    0x20: 1, 0x21: 1, 0x22: 1, 0x23: 1, 0x24: 1, 0x25: 1, 0x26: 1, 0x27: 1,
    0x01: 3, 0x03: 3, 0x0b: 3, 0x0f: 3, 0x11: 3, 0x15: 3, 0x17: 3,
    0x0c: 2, 0x10: 2, 0x12: 2, 0x16: 2, 0x18: 2,
    0x02: 5, 0x06: 5, 0x07: 5, 0x0a: 5, 0x0d: 5,
  };
  const size = sizes[op];
  if (size === undefined) {
    console.log('  unknown opcode, stop');
    break;
  }
  pc += size;
  count++;
}
console.log('decoded', count, 'instructions, final pc', pc.toString(16));
