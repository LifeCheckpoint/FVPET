/**
 * preload：通过 contextBridge 暴露最小化的 rfvp 引擎桥。
 * 渲染层（ui 包）经 window.rfvp 访问；无此桥时自动回退 FakeEngine。
 *
 * sandbox 模式下仅可用 contextBridge / ipcRenderer 等有限模块，
 * 此处只使用这两个，保证在默认 sandbox 下也能工作。
 */

import { contextBridge, ipcRenderer } from 'electron';

interface RfvpLoadResult {
  readonly title: string | null;
  readonly screenSize: readonly [number, number] | null;
}

const rfvpApi = {
  load: (bytes: Uint8Array, nls: string): Promise<RfvpLoadResult> =>
    ipcRenderer.invoke('rfvp:load', { bytes, nls }),
  advance: (): Promise<void> => ipcRenderer.invoke('rfvp:advance'),
  step: (): Promise<void> => ipcRenderer.invoke('rfvp:step'),
  skip: (): Promise<void> => ipcRenderer.invoke('rfvp:skip'),
  dumpPrims: (): Promise<void> => ipcRenderer.invoke('rfvp:dump-prims'),
  shutdown: (): Promise<void> => ipcRenderer.invoke('rfvp:shutdown'),
  onEvent: (handler: (event: unknown) => void): (() => void) => {
    const listener = (_event: unknown, ev: unknown) => {
      handler(ev);
    };
    ipcRenderer.on('rfvp:event', listener);
    return () => {
      ipcRenderer.removeListener('rfvp:event', listener);
    };
  },
  onExit: (handler: (code: number | null) => void): (() => void) => {
    const listener = (_event: unknown, code: number | null) => {
      handler(code);
    };
    ipcRenderer.on('rfvp:exit', listener);
    return () => {
      ipcRenderer.removeListener('rfvp:exit', listener);
    };
  },
};

const baseGameApi = {
  readBaseHcb: (gameId: string, path?: string): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('base-game:read', { gameId, path }),
};

contextBridge.exposeInMainWorld('rfvp', rfvpApi);
contextBridge.exposeInMainWorld('baseGame', baseGameApi);
