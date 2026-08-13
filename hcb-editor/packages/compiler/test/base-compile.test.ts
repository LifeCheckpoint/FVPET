/**
 * compileProject 底座编译选项测试：
 * - extraBackgrounds（共享加载器，分配资源编号）无需底座二进制即可工作。
 * - extraCharacters 无 baseData 时明确抛错。
 * - 有本地底座二进制时（skipIf 缺失），compileWithBase 产物可被 decodeHcb 解析，
 *   且新增角色函数体包含新名字（emitFunctionDef 回归）。
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeHcb } from '@hcb-editor/hcb/decompile';
import type { IrScript } from '@hcb-editor/hcb/ir';
import { compileProject } from '../src/base/index.js';

const BASE = path.resolve(process.cwd(), '../../../.reference_repo/fvpanalysis/hcbtool_test/Sakura.hcb');

const speakScript = (speaker: string): IrScript => ({
  header: { schemaVersion: 1, engine: 'fvp', game: 'sakura-moyu', nls: 'sjis' },
  nodes: [
    { kind: 'label', name: 'start' },
    { kind: 'speak', speaker, text: 'こんにちは。' },
  ],
});

describe('compileProject base options', () => {
  it('allocates a new background number without base binary', () => {
    const ir: IrScript = {
      header: { schemaVersion: 1, engine: 'fvp', game: 'sakura-moyu', nls: 'sjis' },
      nodes: [
        { kind: 'label', name: 'start' },
        { kind: 'bgset', background: 'bg_custom' },
      ],
    };
    const bytes = compileProject(ir, 'sjis', { extraBackgrounds: [{ name: 'bg_custom' }] });
    expect(bytes.length).toBeGreaterThan(0);
    const decoded = decodeHcb(bytes, 'sjis');
    expect(decoded.instructions.length).toBeGreaterThan(0);
  });

  it('rejects new characters without base binary', () => {
    expect(() =>
      compileProject(speakScript('小明'), 'sjis', { extraCharacters: ['小明'] }),
    ).toThrow(/baseData/);
  });
});

describe.skipIf(!fs.existsSync(BASE))('compileProject with local base binary', () => {
  it('compileWithBase output decodes and contains the new character function', () => {
    const baseData = new Uint8Array(fs.readFileSync(BASE));
    const bytes = compileProject(speakScript('小明'), 'sjis', { baseData, extraCharacters: ['小明'] });
    const decoded = decodeHcb(bytes, 'sjis');
    expect(decoded.instructions.length).toBeGreaterThan(0);
    // 新角色函数体应包含名栏显示串（去全角空格后等于 小明）。
    const texts = decoded.instructions
      .filter((i) => i.mnemonic === 'push_string' && i.args.kind === 'string')
      .map((i) => i.args.text.replace(/[\u3000 ]/g, ''));
    expect(texts).toContain('小明');
  });
});
