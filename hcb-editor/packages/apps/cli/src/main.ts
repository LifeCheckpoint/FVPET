#!/usr/bin/env node
/**
 * hcb-editor headless CLI。
 * 命令：decompile / roundtrip / compile（compile 为语义 IR -> HCB，M1 后续补全 lower/assemble）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodeHcb } from '@hcb-editor/hcb/decompile';
import type { HcbDecoded } from '@hcb-editor/hcb/decompile';
import { normalizeNls } from '@hcb-editor/hcb/core';
import type { Instruction } from '@hcb-editor/hcb/core';
import { IrScript } from '@hcb-editor/hcb/ir';
import { compile, encodeFromFlat } from '@hcb-editor/compiler/passes';
import {
  arithmeticTemplate,
  audioTemplate,
  bgsetTemplate,
  branchTemplate,
  bsfadeTemplate,
  bssetTemplate,
  callTemplate,
  cgsetTemplate,
  controlTemplate,
  diaTemplate,
  eyecatchTemplate,
  inputTemplate,
  jumpTemplate,
  measureCoverage,
  msgsetTemplate,
  selsetTemplate,
  speakTemplate,
  stageTemplate,
  threadTemplate,
  waitTemplate,
  whiteTemplate,
} from '@hcb-editor/compiler/templates';
import type { GameTables } from '@hcb-editor/compiler/templates';

interface CliArgs {
  cmd: string;
  input: string;
  output?: string;
  nls?: string;
  prefix?: string;
  base?: string;
  game?: string;
}

function usage(): never {
  process.stderr.write(
    'usage:\n' +
      '  hcb-editor roundtrip <file.hcb> [--nls sjis] [-o out.hcb]\n' +
      '  hcb-editor decompile <file.hcb> [--nls sjis] [-o outdir] [--prefix name]\n' +
      '  hcb-editor compile <file.ir.json> [--base base.hcb] [--nls sjis] [-o out.hcb]\n' +
      '  hcb-editor extract-base <file.hcb> --game sakura-moyu [--nls sjis] [-o outdir]\n' +
      '  hcb-editor coverage <file.hcb> [--nls sjis]\n' +
      '  hcb-editor bgset-probe <file.hcb> [--nls sjis] [--prefix 0x4115a]\n',
  );
  process.exit(2);
}

function parseArgs(argv: string[]): CliArgs {
  const cmd = argv[0];
  if (!cmd) {
    usage();
  }
  const positional: string[] = [];
  const args: CliArgs = { cmd, input: '' };
  const nextValue = (i: number): string => {
    const v = argv[i];
    if (v === undefined) {
      process.stderr.write(`missing value for ${argv[i - 1] ?? 'option'}\n`);
      usage();
    }
    return v;
  };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--nls') {
      args.nls = nextValue(++i);
    } else if (a === '-o') {
      args.output = nextValue(++i);
    } else if (a === '--prefix') {
      args.prefix = nextValue(++i);
    } else if (a === '--base') {
      args.base = nextValue(++i);
    } else if (a === '--game') {
      args.game = nextValue(++i);
    } else if (a.startsWith('-')) {
      process.stderr.write(`unknown option: ${a}\n`);
      usage();
    } else {
      positional.push(a);
    }
  }
  args.input = positional[0] ?? '';
  if (!args.input) {
    usage();
  }
  return args;
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function serializeInstruction(inst: Instruction): Record<string, unknown> {
  const args = (() => {
    switch (inst.args.kind) {
      case 'none':
        return {};
      case 'init_stack':
        return { args: inst.args.args, locals: inst.args.locals };
      case 'x32':
        return { target: inst.args.target };
      case 'syscall':
        return { id: inst.args.id, name: inst.args.name, arg_count: inst.args.argCount };
      case 'i32':
        return { value: inst.args.value };
      case 'i16':
        return { value: inst.args.value };
      case 'i8':
        return { value: inst.args.value };
      case 'f32':
        return { value: inst.args.value };
      case 'string':
        return { length: inst.args.length, text: inst.args.text, raw_hex: bytesToHex(inst.args.rawBytes) };
      case 'u16':
        return { index: inst.args.index };
      case 'i8idx':
        return { index: inst.args.index };
    }
  })();
  return {
    addr: inst.addr,
    opcode: inst.opcode,
    mnemonic: inst.mnemonic,
    args,
    size: inst.size,
    raw_hex: bytesToHex(inst.rawBytes),
    ...(inst.addressRole ? { address_role: inst.addressRole } : {}),
  };
}

function serializeDecoded(decoded: HcbDecoded): Record<string, unknown> {
  return {
    sysdesc: {
      entry_point: decoded.sysdesc.entryPoint,
      non_volatile_global_count: decoded.sysdesc.nonVolatileGlobalCount,
      volatile_global_count: decoded.sysdesc.volatileGlobalCount,
      game_mode: decoded.sysdesc.gameMode,
      game_mode_reserved: decoded.sysdesc.gameModeReserved,
      game_title: decoded.sysdesc.gameTitle,
      syscalls: decoded.sysdesc.syscalls.map((s) => ({ id: s.id, args: s.args, name: s.name })),
      custom_syscall_count: decoded.sysdesc.customSyscallCount,
    },
    functions: decoded.functions.map((f) => ({
      name: f.name,
      start_addr: f.startAddr,
      end_addr: f.endAddr,
      args_count: f.argsCount,
      locals_count: f.localsCount,
      is_entry: f.isEntry,
      instruction_addrs: f.instructionAddrs,
    })),
    instructions: decoded.instructions.map(serializeInstruction),
  };
}

function templateCoverage(insts: readonly Instruction[]): Record<string, number> {
  const result = measureCoverage(insts, [diaTemplate, speakTemplate]);
  const counts: Record<string, number> = {};
  for (const h of result.hits) {
    counts[h.id] = h.count;
  }
  counts.total_instructions = result.total;
  counts.covered_instructions = result.covered;
  counts.coverage_rate = result.rate;
  return counts;
}

function cmdRoundtrip(args: CliArgs): void {
  const data = new Uint8Array(readFileSync(args.input));
  const nls = normalizeNls(args.nls);
  const decoded = decodeHcb(data, nls);
  const encoded = encodeFromFlat(decoded.instructions, decoded.sysdesc, nls);
  const identical = Buffer.from(encoded).equals(Buffer.from(data));
  if (args.output) {
    writeFileSync(args.output, encoded);
  }
  process.stdout.write(
    `roundtrip: ${args.input}\n` +
      `  instructions=${decoded.instructions.length} functions=${decoded.functions.length}\n` +
      `  identical=${identical ? 'yes' : 'no'} (in=${data.length}, out=${encoded.length})\n`,
  );
  if (!identical) {
    process.exitCode = 1;
  }
}

function cmdDecompile(args: CliArgs): void {
  const data = new Uint8Array(readFileSync(args.input));
  const nls = normalizeNls(args.nls);
  const decoded = decodeHcb(data, nls);
  const json = JSON.stringify(serializeDecoded(decoded), null, 2);
  const coverage = templateCoverage(decoded.instructions);
  if (args.output) {
    const prefix = args.prefix ?? 'out';
    writeFileSync(`${args.output}/${prefix}.ir.json`, json);
    writeFileSync(`${args.output}/${prefix}.coverage.json`, JSON.stringify(coverage, null, 2));
  }
  process.stdout.write(
    `decompile: ${args.input}\n` +
      `  functions=${decoded.functions.length} instructions=${decoded.instructions.length}\n` +
      `  template coverage: ${JSON.stringify(coverage)}\n`,
  );
}

function cmdCompile(args: CliArgs): void {
  const nls = normalizeNls(args.nls);
  if (!args.base) {
    process.stderr.write('compile 需要 --base <base.hcb> 提供底座 sysdesc（syscall 导入表）\n');
    process.exit(2);
    return;
  }
  const baseData = new Uint8Array(readFileSync(args.base));
  const sysdesc = decodeHcb(baseData, nls).sysdesc;
  const raw = JSON.parse(readFileSync(args.input, 'utf8')) as unknown;
  const irScript = IrScript.parse(raw);
  const tables: GameTables = { characters: {}, backgrounds: {}, globals: {} };
  const out = compile(irScript, { sysdesc, tables, nls });
  if (args.output) {
    writeFileSync(args.output, out);
  }
  process.stdout.write(
    `compile: ${args.input} -> ${args.output ?? '<stdout>'} (${out.length} bytes, ${irScript.nodes.length} nodes)\n`,
  );
}

function toIdent(game: string): string {
  const parts = game.split(/[^a-zA-Z0-9]+/).filter((p) => p.length > 0);
  if (parts.length === 0) {
    return 'baseGame';
  }
  return parts
    .map((p, i) => (i === 0 ? p.toLowerCase() : `${p[0]!.toUpperCase()}${p.slice(1)}`))
    .join('');
}

function pickCharacterName(texts: readonly string[]): string {
  // 名栏显示形如 '\u3000\u3000{name}\u3000\u3000'，且往往带 '\u3000 ？？？ \u3000' 占位。
  // 取最后一个「去除全角/半角空格后非空、且不是 ？？？ 占位」的串（即完整名形式）。
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const stripped = texts[i]!.replace(/[\u3000 ]/g, '');
    if (stripped.length > 0 && stripped !== '？？？') {
      return stripped;
    }
  }
  return '';
}

function cmdExtractBase(args: CliArgs): void {
  const game = args.game ?? 'sakura-moyu';
  const nls = normalizeNls(args.nls);
  const data = new Uint8Array(readFileSync(args.input));
  const decoded = decodeHcb(data, nls);

  const instByAddr = new Map(decoded.instructions.map((i) => [i.addr, i]));

  // 扫描所有函数：凡函数体内含名栏显示串（全角空格包裹、去空白后非空且非 ？？？ 占位）
  // 即视为 SPEAK 名栏函数，name -> speakFn。
  const characters: Record<string, { readonly speakFn: number }> = {};
  const speakCandidates: string[] = [];
  for (const func of decoded.functions) {
    const texts: string[] = [];
    for (const a of func.instructionAddrs) {
      const inst = instByAddr.get(a);
      if (inst?.mnemonic === 'push_string' && inst.args.kind === 'string') {
        texts.push(inst.args.text);
      }
    }
    if (texts.length === 0) {
      continue;
    }
    // 排除「名表函数」（一条函数罗列全部名字，push_string 数量远超单个名栏函数）。
    if (texts.length > 12) {
      continue;
    }
    // SPEAK 名栏函数首条 push_string 必为 '\u3000 ？？？ \u3000' 占位。
    const first = texts[0]!.replace(/[\u3000 ]/g, '');
    if (first !== '？？？') {
      continue;
    }
    const name = pickCharacterName(texts);
    if (name) {
      characters[name] = { speakFn: func.startAddr };
      speakCandidates.push(`0x${func.startAddr.toString(16).padStart(8, '0')} -> ${JSON.stringify(texts)}`);
    }
  }

  // 背景：push_i16 <编号> + call f_00037421（Sakura moyu 共享加载函数，编号为资源 id）。
  const BG_LOADER = 0x00037421;
  const backgrounds: Record<string, { readonly fn: number; readonly number: number }> = {};
  for (let i = 1; i < decoded.instructions.length; i += 1) {
    const inst = decoded.instructions[i]!;
    if (inst.mnemonic === 'call' && inst.args.kind === 'x32' && inst.args.target === BG_LOADER) {
      const prev = decoded.instructions[i - 1]!;
      if (prev.mnemonic === 'push_i16' && prev.args.kind === 'i16') {
        backgrounds[`bg_${prev.args.value}`] = { fn: BG_LOADER, number: prev.args.value };
      }
    }
  }

  const summary = {
    sysdesc: {
      entryPoint: decoded.sysdesc.entryPoint,
      nonVolatileGlobalCount: decoded.sysdesc.nonVolatileGlobalCount,
      volatileGlobalCount: decoded.sysdesc.volatileGlobalCount,
      gameMode: decoded.sysdesc.gameMode,
      gameModeReserved: decoded.sysdesc.gameModeReserved,
      gameTitle: decoded.sysdesc.gameTitle,
      syscalls: decoded.sysdesc.syscalls.map((s) => ({ args: s.args, name: s.name })),
      customSyscallCount: decoded.sysdesc.customSyscallCount,
    },
    characters,
    backgrounds,
    globals: { optionResult: 103, speakerStyle: 227 } as Record<string, number>,
  };

  if (args.output) {
    mkdirSync(args.output, { recursive: true });
    const varName = `${toIdent(game)}BaseData`;
    const ts = [
      '// 本文件由 hcb-editor extract-base 生成（数据驱动底座，勿手改）。',
      `export const ${varName} = ${JSON.stringify(summary, null, 2)} as const;`,
      '',
    ].join('\n');
    const outPath = `${args.output}/${game}.ts`;
    writeFileSync(outPath, ts);
    process.stdout.write(
      `extract-base: ${args.input}\n  game=${game}\n  syscalls=${summary.sysdesc.syscalls.length}\n` +
        `  characters=${Object.keys(characters).length}\n  wrote=${outPath}\n`,
    );
  }

  process.stdout.write('\n-- SPEAK 名栏函数候选（校验用）--\n');
  for (const line of speakCandidates) {
    process.stdout.write(`  ${line}\n`);
  }
}
function findFunctionContaining(addr: number, funcs: readonly HcbDecoded['functions'][number][]): HcbDecoded['functions'][number] | undefined {
  return funcs.find((f) => addr >= f.startAddr && addr < f.endAddr);
}

function cmdBgsetProbe(args: CliArgs): void {
  const nls = normalizeNls(args.nls);
  const data = new Uint8Array(readFileSync(args.input));
  const decoded = decodeHcb(data, nls);
  const insts = decoded.instructions;
  const TAIL = Number.parseInt(args.prefix ?? '0x4115a', 16);

  const tails: number[] = [];
  for (let i = 0; i < insts.length; i += 1) {
    const inst = insts[i]!;
    if (inst.mnemonic === 'call' && inst.args.kind === 'x32' && inst.args.target === TAIL) {
      tails.push(i);
    }
  }
  process.stdout.write(`call 0x${TAIL.toString(16)} 出现 ${tails.length} 次\n`);
  for (const idx of tails.slice(0, 8)) {
    process.stdout.write(`\n=== tail @${idx} ===\n`);
    for (let j = Math.max(0, idx - 14); j <= idx; j += 1) {
      const inst = insts[j]!;
      const arg =
        inst.args.kind === 'x32'
          ? `0x${inst.args.target.toString(16).padStart(8, '0')}`
          : inst.args.kind === 'syscall'
            ? inst.args.name
            : inst.args.kind === 'i8' || inst.args.kind === 'i16' || inst.args.kind === 'i32'
              ? String(inst.args.value)
              : '';
      process.stdout.write(`  ${inst.mnemonic} ${arg}\n`);
    }
  }
}

function cmdCoverage(args: CliArgs): void {
  const nls = normalizeNls(args.nls);
  const data = new Uint8Array(readFileSync(args.input));
  const decoded = decodeHcb(data, nls);

  const instByAddr = new Map(decoded.instructions.map((i) => [i.addr, i]));
  const funcByStart = new Map(decoded.functions.map((f) => [f.startAddr, f]));

  // 剧情节点口径 A：从入口沿 call/jmp/jz 可达的函数集合（库函数定义体不计入）。
  const reachable = new Set<number>();
  const queue: number[] = [decoded.sysdesc.entryPoint];
  while (queue.length > 0) {
    const addr = queue.shift()!;
    const func = funcByStart.get(addr) ?? findFunctionContaining(addr, decoded.functions);
    if (!func || reachable.has(func.startAddr)) {
      continue;
    }
    reachable.add(func.startAddr);
    for (const ia of func.instructionAddrs) {
      const inst = instByAddr.get(ia);
      if (
        inst &&
        (inst.mnemonic === 'call' || inst.mnemonic === 'jmp' || inst.mnemonic === 'jz') &&
        inst.args.kind === 'x32' &&
        funcByStart.has(inst.args.target)
      ) {
        queue.push(inst.args.target);
      }
    }
  }

  const reachableInsts: Instruction[] = [];
  for (const start of reachable) {
    const func = funcByStart.get(start);
    if (!func) {
      continue;
    }
    for (const ia of func.instructionAddrs) {
      const inst = instByAddr.get(ia);
      if (inst) {
        reachableInsts.push(inst);
      }
    }
  }
  reachableInsts.sort((a, b) => a.addr - b.addr);

  const templates = [
    selsetTemplate,
    bgsetTemplate,
    cgsetTemplate,
    msgsetTemplate,
    bssetTemplate,
    speakTemplate,
    diaTemplate,
    audioTemplate,
    threadTemplate,
    waitTemplate,
    branchTemplate,
    stageTemplate,
    inputTemplate,
    arithmeticTemplate,
    controlTemplate,
    callTemplate,
    jumpTemplate,
    eyecatchTemplate,
    bsfadeTemplate,
    whiteTemplate,
  ];
  const coverage = measureCoverage(reachableInsts, templates);
  const hits: Record<string, number> = {};
  for (const h of coverage.hits) {
    hits[h.id] = h.count;
  }

  process.stdout.write(
    `coverage（剧情节点口径 A）：${args.input}\n` +
      `  total_functions=${decoded.functions.length} reachable_functions=${reachable.size}\n` +
      `  reachable_instructions=${coverage.total} covered=${coverage.covered} rate=${(coverage.rate * 100).toFixed(2)}%\n` +
      `  hits=${JSON.stringify(hits)}\n`,
  );

  const callCounts = new Map<number, number>();
  const syscallCounts = new Map<string, number>();
  for (const inst of reachableInsts) {
    if (inst.mnemonic === 'call' && inst.args.kind === 'x32') {
      callCounts.set(inst.args.target, (callCounts.get(inst.args.target) ?? 0) + 1);
    } else if (inst.mnemonic === 'syscall' && inst.args.kind === 'syscall') {
      syscallCounts.set(inst.args.name, (syscallCounts.get(inst.args.name) ?? 0) + 1);
    }
  }

  process.stdout.write('\n-- 可达指令 top call 目标 --\n');
  for (const [addr, n] of [...callCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    process.stdout.write(`  0x${addr.toString(16).padStart(8, '0')}  ${String(n).padStart(7)}\n`);
  }
  process.stdout.write('\n-- 可达指令 top syscall --\n');
  for (const [name, n] of [...syscallCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    process.stdout.write(`  ${String(n).padStart(7)}  ${name}\n`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  switch (args.cmd) {
    case 'roundtrip':
      cmdRoundtrip(args);
      break;
    case 'decompile':
      cmdDecompile(args);
      break;
    case 'compile':
      cmdCompile(args);
      break;
    case 'extract-base':
      cmdExtractBase(args);
      break;
    case 'coverage':
      cmdCoverage(args);
      break;
    case 'bgset-probe':
      cmdBgsetProbe(args);
      break;
    default:
      process.stderr.write(`unknown command: ${args.cmd}\n`);
      usage();
  }
}

main();
