/**
 * rfvp IPC 接线：把渲染层的调用转发给 RfvpProcessManager，
 * 并把引擎事件 / 退出广播回所有窗口。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';
import type { RfvpLoadResult, RfvpProcessManager } from './rfvp-process-manager.js';

/** 底座游戏 id → 原版 HCB 文件名（默认 auto-discovery 用）。 */
const BASE_FILES: Record<string, string> = {
  'sakura-moyu': 'Sakura.hcb',
};

/** 默认底座 HCB 路径：向上 5 级到工作区根，再进 .reference_repo（仅本机开发用）。 */
function defaultBaseHcbPath(gameId: string): string {
  const file = BASE_FILES[gameId] ?? `${gameId}.hcb`;
  return path.resolve(
    __dirname,
    '..', '..', '..', '..', '..',
    '.reference_repo', 'fvpanalysis', 'hcbtool_test', file,
  );
}

/** 底座游戏二进制读取桥：Electron 主进程读本地文件，供渲染层 compileWithBase 用。 */
export function registerBaseGameIpc(): void {
  ipcMain.handle(
    'base-game:read',
    (_event, payload: { gameId: string; path?: string }): Uint8Array | null => {
      const requested = payload.path && payload.path.trim() !== '' ? payload.path : undefined;
      const resolved = requested
        ? path.isAbsolute(requested)
          ? requested
          : path.resolve(process.cwd(), requested)
        : defaultBaseHcbPath(payload.gameId);
      if (!fs.existsSync(resolved)) {
        return null;
      }
      return new Uint8Array(fs.readFileSync(resolved));
    },
  );
}

interface RfvpLoadPayload {
  readonly bytes: Uint8Array;
  readonly nls: string;
}

export function registerRfvpIpc(manager: RfvpProcessManager): void {
  manager.onEvent((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('rfvp:event', event);
    }
  });

  manager.onExit((code) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('rfvp:exit', code);
    }
  });

  ipcMain.handle('rfvp:load', (_event, payload: RfvpLoadPayload): Promise<RfvpLoadResult> => {
    return manager.load(payload.bytes, payload.nls);
  });

  ipcMain.handle('rfvp:advance', () => {
    manager.advance();
  });

  ipcMain.handle('rfvp:step', () => {
    manager.step();
  });

  ipcMain.handle('rfvp:skip', () => {
    manager.skip();
  });

  ipcMain.handle('rfvp:dump-prims', () => {
    manager.dumpPrims();
  });

  ipcMain.handle('rfvp:shutdown', () => {
    manager.shutdown();
  });
}
