import { readFileSync } from 'node:fs';

const path = process.argv[2];
const target = process.argv[3] ?? 'f_0004CEFD';
const lines = readFileSync(path, 'utf8').split('\n');

// 找到所有 `__ret = target(` 行，回溯同 block 的前 12 行，打印参数准备模式
let count = 0;
for (let i = 0; i < lines.length && count < 5; i++) {
  if (!lines[i].includes(`__ret = ${target}(`)) continue;
  count++;
  const start = Math.max(0, i - 12);
  console.log(`\n=== callsite #${count} at line ${i + 1} ===`);
  for (let j = start; j <= i; j++) {
    console.log(lines[j]);
  }
}
