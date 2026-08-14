/**
 * rfvp IPC 接线：把渲染层的调用转发给 RfvpProcessManager，
 * 并把引擎事件 / 退出广播回所有窗口。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { RfvpLoadResult, RfvpProcessManager } from './rfvp-process-manager.js';

/** 底座游戏 id → 原版 HCB 文件名（默认 auto-discovery 用）。 */
const BASE_FILES: Record<string, string> = {
  'sakura-moyu': 'base.chb',
};

/** 默认底座 HCB 路径：向上 5 级到工作区根，再进 .reference_repo（仅本机开发用）。 */
function defaultBaseHcbPath(gameId: string): string {
  const file = BASE_FILES[gameId] ?? `${gameId}.hcb`;
  return path.resolve(
    __dirname,
    '..', '..', '..', '..', '..',
    '.reference_repo', 'SImple-.hcb-Editor', file,
  );
}

export interface ProjectDirAsset {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** 工程目录保存 payload：project.json + 增量资产 + GC 白名单。 */
interface ProjectDirSavePayload {
  readonly defaultName?: string;
  readonly dir?: string;
  readonly projectJson: string;
  readonly dirtyAssets: ProjectDirAsset[];
  readonly referencedPaths: string[];
}

/**
 * 增量写入工程目录：
 * - 写 project.json；
 * - 只写变化的资产（目标文件已存在且大小一致则跳过）；
 * - GC：删除 assets/ 下不再被引用的文件（内容寻址下旧资源会被自然淘汰）。
 */
function writeProjectDir(
  dir: string,
  projectJson: string,
  dirtyAssets: ProjectDirAsset[],
  referencedPaths: string[],
): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), projectJson, 'utf8');

  const referenced = new Set(referencedPaths);
  for (const asset of dirtyAssets) {
    const assetPath = path.join(dir, asset.path);
    let skip = false;
    try {
      if (fs.existsSync(assetPath) && fs.statSync(assetPath).size === asset.bytes.length) {
        skip = true;
      }
    } catch {
      skip = false;
    }
    if (skip) {
      continue;
    }
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, new Uint8Array(asset.bytes));
  }

  // GC：删除不再被 project.json 引用的资产文件。
  const assetsDir = path.join(dir, 'assets');
  if (fs.existsSync(assetsDir)) {
    const walk = (base: string): void => {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        const full = path.join(base, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          const rel = path.relative(dir, full).split(path.sep).join('/');
          if (!referenced.has(rel)) {
            fs.rmSync(full, { force: true });
          }
        }
      }
    };
    walk(assetsDir);
  }
}

/** 工程目录桥：工程 = project.json + assets/ 目录，资源文件落盘（增量 + GC）。 */
export function registerProjectDirIpc(): void {
  ipcMain.handle(
    'project-dir:save',
    async (_event, payload: ProjectDirSavePayload): Promise<string | null> => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = win
        ? await dialog.showSaveDialog(win, { defaultPath: payload.defaultName ?? 'my-project' })
        : { canceled: true, filePath: undefined };
      if (result.canceled || !result.filePath) {
        return null;
      }
      writeProjectDir(result.filePath, payload.projectJson, payload.dirtyAssets, payload.referencedPaths);
      return result.filePath;
    },
  );

  // 静默保存到已知目录（自动保存 / 写回原目录，不弹对话框）。
  ipcMain.handle('project-dir:save-as', async (_event, payload: ProjectDirSavePayload): Promise<string> => {
    const dir = payload.dir;
    if (!dir) {
      throw new Error('save-as 缺少目标目录');
    }
    writeProjectDir(dir, payload.projectJson, payload.dirtyAssets, payload.referencedPaths);
    return dir;
  });

  // 打开工程目录：只读 project.json（资源二进制按需经资产协议加载，不与打开耦合）。
  ipcMain.handle(
    'project-dir:open',
    async (): Promise<{ projectJson: string; dir: string } | null> => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
        : { canceled: true, filePaths: [] };
      const dir = result.filePaths?.[0];
      if (result.canceled || !dir) {
        return null;
      }
      const projectPath = path.join(dir, 'project.json');
      if (!fs.existsSync(projectPath)) {
        return null;
      }
      const projectJson = fs.readFileSync(projectPath, 'utf8');
      return { projectJson, dir };
    },
  );
}

/** 原生文件对话框桥：保存/打开工程与导出 .hcb。 */
export function registerFileDialogIpc(): void {
  ipcMain.handle(
    'file-dialog:save-text',
    async (_event, payload: { defaultName: string; content: string }): Promise<string | null> => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = win
        ? await dialog.showSaveDialog(win, { defaultPath: payload.defaultName })
        : { canceled: true, filePath: undefined };
      if (result.canceled || !result.filePath) {
        return null;
      }
      fs.writeFileSync(result.filePath, payload.content, 'utf8');
      return result.filePath;
    },
  );

  ipcMain.handle(
    'file-dialog:save-binary',
    async (_event, payload: { defaultName: string; content: Uint8Array }): Promise<string | null> => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = win
        ? await dialog.showSaveDialog(win, { defaultPath: payload.defaultName })
        : { canceled: true, filePath: undefined };
      if (result.canceled || !result.filePath) {
        return null;
      }
      fs.writeFileSync(result.filePath, new Uint8Array(payload.content));
      return result.filePath;
    },
  );

  ipcMain.handle('file-dialog:open-text', async (): Promise<{ name: string; text: string; path: string } | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [{ name: '工程文件', extensions: ['json', 'hcbproj.json'] }],
        })
      : { canceled: true, filePaths: [] };
    const filePath = result.filePaths?.[0];
    if (result.canceled || !filePath) {
      return null;
    }
    return { name: path.basename(filePath), path: filePath, text: fs.readFileSync(filePath, 'utf8') };
  });

  ipcMain.handle('file-dialog:open-path', async (): Promise<{ name: string; path: string } | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [{ name: '资源归档', extensions: ['bin'] }],
        })
      : { canceled: true, filePaths: [] };
    const filePath = result.filePaths?.[0];
    if (result.canceled || !filePath) {
      return null;
    }
    return { name: path.basename(filePath), path: filePath };
  });
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
  readonly scriptEntry: number;
  readonly labels?: Readonly<Record<string, number>>;
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
    return manager.load(payload.bytes, payload.nls, payload.scriptEntry, payload.labels);
  });

  ipcMain.handle('rfvp:jump', (_event, payload: { label: string }) => {
    manager.jump(payload.label);
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
