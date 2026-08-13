/**
 * FakeEngine：rfvp 协议的内存实现（伪脚本状态机）。
 * UI 组件测试 / Storybook / Playwright 全用它驱动，不依赖真二进制。
 *
 * 支持两种模式：
 *   1. 脚本驱动：load(FakeScript) 后按 advance/step 推进，产出 text/waiting_text/done 事件。
 *   2. 事件回放：replay(events) 直接按队列重放（用于真实会话回归）。
 */

import type { RfvpEvent as RfvpEventT, RfvpRequest as RfvpRequestT } from './protocol.js';

export interface FakePrim {
  readonly id: number;
  readonly graphId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly alpha: number;
  readonly scale: number;
  readonly rotate: number;
  readonly blend: number;
  /** 可选宽高（真实引擎 draw_solid 的矩形尺寸；缺省时用占位尺寸绘制）。 */
  w?: number | undefined;
  h?: number | undefined;
  /** 可选显示标签（立绘占位显示角色名，真实引擎无此字段）。 */
  label?: string | undefined;
  /** 可选立绘图片 data URL（资源管理器导入后用于预览真图）。 */
  image?: string | undefined;
  /** 可选：铺满舞台（背景图）。 */
  fullscreen?: boolean | undefined;
  /** 可选：表情叠加（在 body 立绘之上再叠一张人脸切片，坐标为 body 像素空间）。 */
  face?: {
    readonly image: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly bodyWidth: number;
    readonly bodyHeight: number;
  } | undefined;
}

export interface FakeScript {
  readonly texts: readonly {
    readonly text: string;
    readonly speaker?: string;
    readonly audioSrc?: string;
    /** selset 的选项文本（预览渲染为可点击选项浮层）。 */
    readonly choices?: readonly string[];
  }[];
  readonly globals?: Readonly<Record<number, unknown>>;
  readonly prims?: readonly FakePrim[];
}

export class FakeEngine {
  private texts: readonly { text: string; speaker?: string }[] = [];
  private cursor = 0;
  private waiting = false;
  private globals = new Map<number, unknown>();
  private prims: readonly FakePrim[] = [];
  private replayQueue: RfvpEventT[] = [];

  load(script: FakeScript): void {
    this.texts = script.texts;
    this.cursor = 0;
    this.waiting = false;
    this.globals = new Map(Object.entries(script.globals ?? {}).map(([k, v]) => [Number(k), v]));
    this.prims = script.prims ?? [];
    this.replayQueue = [];
  }

  /** 事件回放模式：直接注入真实会话录制的 Event 流。 */
  replay(events: readonly RfvpEventT[]): void {
    this.replayQueue = [...events];
  }

  handle(req: RfvpRequestT): RfvpEventT[] {
    switch (req.op) {
      case 'handshake':
        return [{ type: 'ready', protocolVersion: req.protocolVersion }];
      case 'load':
        this.load({ texts: [], prims: this.prims });
        return [{ type: 'ready', protocolVersion: 1 }];
      case 'jump':
        this.cursor = 0;
        return this.emitCurrent();
      case 'step':
        return this.step();
      case 'advance':
        return this.advance();
      case 'skip':
        return this.skip();
      case 'get_g':
        return [{ type: 'g', index: req.index, value: this.globals.get(req.index) ?? null }];
      case 'set_g':
        this.globals.set(req.index, req.value);
        return [{ type: 'g', index: req.index, value: req.value }];
      case 'dump_prims':
        return [{ type: 'prims', prims: [...this.prims] }];
      case 'shutdown':
        return [{ type: 'done' }];
    }
  }

  /** 推进到下一句，发出文本或等待事件。 */
  advance(): RfvpEventT[] {
    if (this.replayQueue.length > 0) {
      const next = this.replayQueue.splice(0, 1);
      return next;
    }
    if (this.waiting) {
      this.waiting = false;
      this.cursor += 1;
    }
    return this.emitCurrent();
  }

  /** 单步（不推进文本，仅推进 VM tick）。 */
  step(): RfvpEventT[] {
    if (this.waiting) {
      this.waiting = false;
      this.cursor += 1;
      return this.emitCurrent();
    }
    return [];
  }

  /** 快进到末尾。 */
  skip(): RfvpEventT[] {
    const events: RfvpEventT[] = [];
    while (this.cursor < this.texts.length) {
      events.push({ type: 'text', slot: 0, text: this.texts[this.cursor]!.text });
      this.cursor += 1;
    }
    events.push({ type: 'done' });
    return events;
  }

  private emitCurrent(): RfvpEventT[] {
    if (this.cursor >= this.texts.length) {
      return [{ type: 'done' }];
    }
    this.waiting = true;
    return [{ type: 'text', slot: 0, text: this.texts[this.cursor]!.text }];
  }
}
