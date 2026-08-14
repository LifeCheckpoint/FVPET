import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyCommand, emptyState } from '@hcb-editor/editor';
import { compileEditorStateDetailed } from '../src/preview/compileFromState.js';
import { spawnRfvpCli } from './rfvp-cli-client.js';

const BASE = path.resolve(process.cwd(), '../../../.reference_repo/SImple-.hcb-Editor/base.chb');
const EXE = path.resolve(process.cwd(), '../../crates/rfvp-cli/target/debug/rfvp-cli.exe');
const TEMP = path.join(os.tmpdir(), 'fvpet-real-preview-entry.hcb');

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPreview(
  hcbPath: string,
  scriptEntry: number,
  labels: Readonly<Record<string, number>>,
): Promise<{ readonly events: readonly Record<string, unknown>[]; readonly stderr: string }> {
  const session = spawnRfvpCli(EXE);
  const send = session.send;

  send({ op: 'handshake', protocolVersion: 2 });
  await wait(40);
  send({ op: 'load', hcbPath, nls: 'gbk', scriptEntry, labels });
  await wait(80);
  send({ op: 'advance' });
  await wait(120);
  send({ op: 'shutdown' });
  await session.waitExit();
  return { events: session.events, stderr: session.stderr };
}

afterAll(() => {
  fs.rmSync(TEMP, { force: true });
});

describe.skipIf(!fs.existsSync(BASE) || !fs.existsSync(EXE))('real preview compiled entry', () => {
  it('starts at the compiled story instead of the preserved base launcher', async () => {
    let state = emptyState();
    state = {
      ...state,
      header: { schemaVersion: 1, engine: 'fvp', game: 'sakura-moyu', nls: 'gbk' },
    };
    state = applyCommand(state, {
      kind: 'add_node',
      node: { kind: 'eyecatch' },
      position: { x: 100, y: 0 },
    }).next;
    const eyecatchId = state.selection.nodeId!;
    state = applyCommand(state, {
      kind: 'connect',
      source: state.document.startNodeId,
      target: eyecatchId,
      kind2: 'next',
    }).next;

    const result = compileEditorStateDetailed(state, new Uint8Array(fs.readFileSync(BASE)));
    fs.writeFileSync(TEMP, result.bytes);
    const runtime = await runPreview(TEMP, result.scriptEntry, result.labels);

    expect(result.scriptEntry).toBe(0x8aec7);
    expect(runtime.events.some((event) => event.type === 'error')).toBe(false);
    expect(runtime.stderr).toContain('graph/eyecatch_BG_A');
    expect(runtime.stderr).not.toContain('graph/main_window');
    expect(runtime.stderr).not.toContain('graph/title_');
    expect(runtime.stderr).not.toContain('graph/logo_');
  }, 15_000);
});
