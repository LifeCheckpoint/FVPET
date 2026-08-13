/**
 * 底座游戏二进制（原版 HCB）加载：Electron 下经 window.baseGame 桥读本地文件；
 * 纯浏览器 / Storybook / Playwright 下无桥，返回 null（编译回退为脚本-only 产物）。
 */

export interface BaseGameBridge {
  readBaseHcb(gameId: string, path?: string): Promise<Uint8Array | null>;
}

declare global {
  interface Window {
    readonly baseGame?: BaseGameBridge;
  }
}

/** 底座二进制缓存：避免每次编译都重新 IPC 读 5MB 原版 HCB。 */
const baseCache = new Map<string, Promise<Uint8Array | null>>();

export function loadBaseBinary(gameId: string, path?: string): Promise<Uint8Array | null> {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }
  const bridge = window.baseGame;
  if (!bridge) {
    return Promise.resolve(null);
  }
  const key = `${gameId}:${path ?? ''}`;
  const cached = baseCache.get(key);
  if (cached) {
    return cached;
  }
  const loading = bridge.readBaseHcb(gameId, path).catch(() => null);
  baseCache.set(key, loading);
  return loading;
}
