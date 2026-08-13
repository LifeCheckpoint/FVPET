/**
 * 渲染层 → Electron 主进程的 rfvp 引擎桥类型 + 探测。
 * Electron 下 preload 暴露 window.rfvp；纯浏览器 / Storybook / Playwright 下无此桥。
 */

import type { RfvpEvent } from '@hcb-editor/rfvp';

export interface RfvpLoadResult {
  readonly title: string | null;
  readonly screenSize: readonly [number, number] | null;
}

export interface RfvpBridge {
  load(bytes: Uint8Array, nls: string): Promise<RfvpLoadResult>;
  advance(): Promise<void>;
  step(): Promise<void>;
  skip(): Promise<void>;
  dumpPrims(): Promise<void>;
  shutdown(): Promise<void>;
  onEvent(handler: (event: RfvpEvent) => void): () => void;
  onExit(handler: (code: number | null) => void): () => void;
}

declare global {
  interface Window {
    readonly rfvp?: RfvpBridge;
  }
}

export function getRfvpBridge(): RfvpBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.rfvp ?? null;
}
