import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { compileProjectDetailed } from '@hcb-editor/compiler';
import type { IrNode, IrScript } from '@hcb-editor/hcb/ir';

const BASE = path.resolve(process.cwd(), '../../../.reference_repo/SImple-.hcb-Editor/base.chb');
const EXE = path.resolve(process.cwd(), '../../crates/rfvp-cli/target/debug/rfvp-cli.exe');
const TEMP_DIR = path.join(os.tmpdir(), 'fvpet-node-compat-regression');

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCase(name: string, nodes: readonly IrNode[]): Promise<{
  readonly errors: readonly string[];
  readonly stderr: string;
  readonly events: readonly Record<string, unknown>[];
}> {
  const ir: IrScript = {
    header: { schemaVersion: 1, engine: 'fvp', game: 'sakura-moyu', nls: 'gbk' },
    nodes: [{ kind: 'label', name: 'start' }, ...nodes],
  };
  const result = compileProjectDetailed(ir, 'gbk', { baseData: new Uint8Array(fs.readFileSync(BASE)) });
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const hcbPath = path.join(TEMP_DIR, `${name}.hcb`);
  fs.writeFileSync(hcbPath, result.bytes);

  const child: ChildProcessWithoutNullStreams = spawn(EXE, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const events: Record<string, unknown>[] = [];
  let stderr = '';
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      events.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // Ignore non-protocol output.
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const send = (request: Record<string, unknown>): void => {
    child.stdin.write(`${JSON.stringify(request)}\n`);
  };
  send({ op: 'handshake', protocolVersion: 2 });
  await wait(20);
  send({ op: 'load', hcbPath, nls: 'gbk', scriptEntry: result.scriptEntry, labels: Object.fromEntries(result.labels) });
  await wait(40);
  for (let i = 0; i < 8; i += 1) {
    send({ op: 'advance' });
    await wait(30);
  }
  send({ op: 'shutdown' });
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  return {
    errors: events.filter((event) => event.type === 'error').map((event) => String(event.message)),
    stderr,
    events,
  };
}

const cases: Readonly<Record<string, readonly IrNode[]>> = {
  dia: [{ kind: 'dia', text: '旁白测试' }],
  speak: [{ kind: 'speak', speaker: 'クロ', text: '角色测试' }],
  bgset: [{ kind: 'bgset', background: 'bg_240', variant: 240 }],
  bsset: [{
    kind: 'bsset', character: 'クロ', pose: 0, costume: 0, expression: 1,
    layout: 0, loc: 'm', z: 0, position: { x: 0, y: 0 }, layer: 0,
  }],
  cgset: [{ kind: 'cgset', name: 'TEST_CG', slot: 240, mode: 5, flag: 2 }],
  bgm_play: [{ kind: 'audio', type: 'bgm', channelOrNum: 1, action: 'play', loop: true }],
  bgm_stop: [{ kind: 'audio', type: 'bgm', channelOrNum: 1, action: 'stop', loop: false }],
  se_play: [{ kind: 'audio', type: 'se', channelOrNum: 1, action: 'play', loop: false }],
  se_loop: [{ kind: 'audio', type: 'se', channelOrNum: 1, action: 'play', loop: true, time: 0 }],
  se_stop: [{ kind: 'audio', type: 'se', channelOrNum: 1, action: 'stop', loop: false, time: 0 }],
  voice: [{ kind: 'audio', type: 'voice', channelOrNum: 1, action: 'play', loop: false }],
  wait: [{ kind: 'wait', ms: 1 }],
  eyecatch: [{ kind: 'eyecatch' }],
  bsfade: [{ kind: 'bsfade' }],
  white: [{ kind: 'white' }],
  branch: [
    { kind: 'branch', cond: { op: 'global_eq', global: 1, value: 0 }, then: 'then', else: 'else' },
    { kind: 'label', name: 'then' }, { kind: 'jump', target: 'end' },
    { kind: 'label', name: 'else' }, { kind: 'label', name: 'end' },
  ],
  thread: [
    { kind: 'thread', slot: 1, entry: 'worker' },
    { kind: 'jump', target: 'end' },
    { kind: 'label', name: 'worker' }, { kind: 'wait', ms: 1 },
    { kind: 'label', name: 'end' },
  ],
};

afterAll(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe.skipIf(!fs.existsSync(BASE) || !fs.existsSync(EXE))('real node compatibility regression', () => {
  for (const [name, nodes] of Object.entries(cases)) {
    it(`${name} 在真实 rfvp-cli 中执行零错误`, async () => {
      let outcome: Awaited<ReturnType<typeof runCase>>;
      try {
        outcome = await runCase(name, nodes);
      } catch (error) {
        throw new Error(`编译失败: ${error instanceof Error ? error.message : String(error)}`);
      }
      expect(
        outcome.errors,
        `真实引擎报告错误: ${JSON.stringify(outcome.errors)}\nstderr: ${outcome.stderr}`,
      ).toEqual([]);
    }, 30_000);
  }
});
