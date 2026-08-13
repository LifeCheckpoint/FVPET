/**
 * RfvpClient：真实引擎的渲染层客户端。
 * - 有 window.rfvp 桥（Electron）→ 真实执行。
 * - 无桥（浏览器 / Storybook / Playwright）→ supported=false，调用方回退 FakeEngine。
 *
 * 文本队列始终由编辑器投影提供（rfvp-cli 只回放 prim / done），
 * 因此客户端只负责 prim / done / error 事件订阅与请求转发。
 */

import type { RfvpEvent } from '@hcb-editor/rfvp';
import { getRfvpBridge, type RfvpLoadResult } from './rfvpBridge.js';

export class RfvpClient {
  readonly supported: boolean;
  private readonly bridge = getRfvpBridge();

  constructor() {
    this.supported = this.bridge !== null;
  }

  load(bytes: Uint8Array, nls: string, labels?: Readonly<Record<string, number>>): Promise<RfvpLoadResult | null> {
    if (!this.bridge) {
      return Promise.resolve(null);
    }
    return this.bridge.load(bytes, nls, labels);
  }

  jump(label: string): Promise<void> {
    return this.bridge ? this.bridge.jump(label) : Promise.resolve();
  }

  advance(): Promise<void> {
    return this.bridge ? this.bridge.advance() : Promise.resolve();
  }

  step(): Promise<void> {
    return this.bridge ? this.bridge.step() : Promise.resolve();
  }

  skip(): Promise<void> {
    return this.bridge ? this.bridge.skip() : Promise.resolve();
  }

  dumpPrims(): Promise<void> {
    return this.bridge ? this.bridge.dumpPrims() : Promise.resolve();
  }

  shutdown(): Promise<void> {
    return this.bridge ? this.bridge.shutdown() : Promise.resolve();
  }

  subscribe(handler: (event: RfvpEvent) => void): () => void {
    if (!this.bridge) {
      return () => {};
    }
    return this.bridge.onEvent(handler);
  }

  subscribeExit(handler: (code: number | null) => void): () => void {
    if (!this.bridge) {
      return () => {};
    }
    return this.bridge.onExit(handler);
  }
}
