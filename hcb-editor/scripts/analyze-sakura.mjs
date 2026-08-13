import { readFileSync } from 'node:fs';

const path = process.argv[2];
const text = readFileSync(path, 'utf8');

// syscall 频率
const syscalls = new Map();
for (const m of text.matchAll(/__syscall\("([^"]+)"/g)) {
  syscalls.set(m[1], (syscalls.get(m[1]) ?? 0) + 1);
}
console.log('=== syscall frequency ===');
for (const [name, n] of [...syscalls.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(7)}  ${name}`);
}

// call 目标函数频率
const calls = new Map();
for (const m of text.matchAll(/__ret = (f_[0-9A-Fa-f]+)\(/g)) {
  calls.set(m[1], (calls.get(m[1]) ?? 0) + 1);
}
console.log('\n=== top call targets ===');
for (const [name, n] of [...calls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  console.log(`${String(n).padStart(7)}  ${name}`);
}
