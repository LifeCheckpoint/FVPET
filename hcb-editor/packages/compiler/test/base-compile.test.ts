/**
 * compileProject 底座编译选项测试：
 * - graph_bg 风格背景名无需专属函数即可通过底层 8 参数加载器编译。
 * - extraCharacters 无 baseData 时明确抛错。
 * - 有本地底座二进制时（skipIf 缺失），compileWithBase 产物可被 decodeHcb 解析，
 *   且新增角色函数体包含新名字（emitFunctionDef 回归）。
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeHcb } from '@hcb-editor/hcb/decompile';
import type { IrScript } from '@hcb-editor/hcb/ir';
import { compileProject, compileProjectDetailed, loadBaseGame } from '../src/base/index.js';

const BASE = path.resolve(process.cwd(), '../../../.reference_repo/SImple-.hcb-Editor/base.chb');

const speakScript = (speaker: string): IrScript => ({
  header: { schemaVersion: 1, engine: 'fvp', game: 'sakura-moyu', nls: 'gbk' },
  nodes: [
    { kind: 'label', name: 'start' },
    { kind: 'speak', speaker, text: 'こんにちは。' },
  ],
});

describe('compileProject base options', () => {
  it('compiles an arbitrary graph_bg group through the safe direct loaders', () => {
    const ir: IrScript = {
      header: { schemaVersion: 1, engine: 'fvp', game: 'sakura-moyu', nls: 'gbk' },
      nodes: [
        { kind: 'label', name: 'start' },
        { kind: 'bgset', background: 'bg_240_20' },
      ],
    };
    const bytes = compileProject(ir, 'gbk');
    const decoded = decodeHcb(bytes, 'gbk');
    const strings = decoded.instructions
      .filter((i) => i.mnemonic === 'push_string' && i.args.kind === 'string')
      .map((i) => (i.args.kind === 'string' ? i.args.text : ''));
    expect(strings).toContain('BG240_020');
    expect(strings).toContain('BG240_020b');
    const calls = decoded.instructions
      .filter((i) => i.mnemonic === 'call' && i.args.kind === 'x32')
      .map((i) => (i.args.kind === 'x32' ? i.args.target : -1));
    expect(calls).toContain(0x0003bb96);
    expect(calls).toContain(0x0003bca3);
    expect(calls).not.toContain(0x00037421);
  });

  it('rejects new characters without base binary', () => {
    expect(() =>
      compileProject(speakScript('小明'), 'gbk', { extraCharacters: ['小明'] }),
    ).toThrow(/baseData/);
  });
});

describe.skipIf(!fs.existsSync(BASE))('compileProject with local base binary', () => {
  it('compileWithBase output decodes and contains the new character function', () => {
    const baseData = new Uint8Array(fs.readFileSync(BASE));
    const bytes = compileProject(speakScript('小明'), 'gbk', { baseData, extraCharacters: ['小明'] });
    const decoded = decodeHcb(bytes, 'gbk');
    expect(decoded.instructions.length).toBeGreaterThan(0);
    // 新角色函数体应包含名栏显示串（去全角空格后等于 小明）。
    const texts = decoded.instructions
      .filter((i) => i.mnemonic === 'push_string' && i.args.kind === 'string')
      .map((i) => i.args.text.replace(/[\u3000 ]/g, ''));
    expect(texts.some((t) => t.includes('小明'))).toBe(true);
  });

  it('appended script starts at mainOffset with init_stack and preserves base function call addresses', () => {
    const { mainOffset } = loadBaseGame('sakura-moyu');
    const baseData = new Uint8Array(fs.readFileSync(BASE));
    const { bytes, scriptEntry } = compileProjectDetailed(speakScript('クロ'), 'gbk', { baseData });
    const decoded = decodeHcb(bytes, 'gbk');

    // sysdesc 仍保留底座 launcher；嵌入式预览应使用独立返回的剧情函数入口。
    expect(decoded.sysdesc.entryPoint).not.toBe(scriptEntry);
    expect(scriptEntry).toBe(mainOffset);
    // 新脚本起点（库代码结束 mainOffset）必须以 init_stack 开头（否则不被识别为函数）。
    const entry = decoded.instructions.find((i) => i.addr === scriptEntry);
    expect(entry).toBeDefined();
    expect(entry!.mnemonic).toBe('init_stack');

    // 追加脚本中的 speak call 必须指向底座库函数地址（クロ speakFn），
    // 不得因重定位键碰撞（脚本旧地址 4 与库函数地址 4 重合）而被改写为脚本起点。
    const croSpeakFn = loadBaseGame('sakura-moyu').tables.characters['クロ']?.speakFn;
    expect(croSpeakFn).toBeDefined();
    const appendedCalls = decoded.instructions
      .filter((i) => i.addr >= mainOffset && i.mnemonic === 'call' && i.args.kind === 'x32')
      .map((i) => (i.args.kind === 'x32' ? i.args.target : -1));
    expect(appendedCalls).toContain(croSpeakFn);
    // 直达剧情入口不能跳过原版 launcher 的消息系统初始化，否则 TextPrint
    // 只会写入未加载的空槽，full rfvp 不会创建可绘制的对话框文字 surface。
    expect(appendedCalls).toContain(0x0003470a);
    expect(appendedCalls).not.toContain(mainOffset);
  });
});
