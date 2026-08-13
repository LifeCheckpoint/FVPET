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

export async function loadBaseBinary(gameId: string, path?: string): Promise<Uint8Array | null> {
  if (typeof window === 'undefined') {
    return null;
  }
  const bridge = window.baseGame;
  if (!bridge) {
    return null;
  }
  try {
    return await bridge.readBaseHcb(gameId, path);
  } catch {
    return null;
  }
}
