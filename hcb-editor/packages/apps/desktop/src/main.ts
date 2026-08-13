/**
 * Electron 主进程：加载 ui 包的 Vite 演示壳，并接入真实引擎桥。
 * - contextIsolation 开启、nodeIntegration 关闭；preload 仅暴露 window.rfvp。
 * - rfvp-cli 由 RfvpProcessManager 惰性拉起，IPC 通道见 ipc.ts。
 */

import * as path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { registerBaseGameIpc, registerFileDialogIpc, registerProjectDirIpc, registerRfvpIpc } from './ipc.js';
import { RfvpProcessManager } from './rfvp-process-manager.js';

/** 演示壳地址：dev 下由 ui 的 Vite dev server 提供（dev:test 固定 5199）。 */
const DEV_URL = process.env.HCB_EDITOR_URL ?? 'http://127.0.0.1:5199';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** dev 下 Vite 启动有先有后，加载失败时退避重试，避免竞态。 */
async function loadWithRetry(win: BrowserWindow, url: string, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await win.loadURL(url);
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`加载演示壳失败：${url}`);
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'FVP 剧情编辑器',
    backgroundColor: '#111318',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  await loadWithRetry(win, DEV_URL);
}

void app.whenReady().then(async () => {
  const manager = new RfvpProcessManager();
  registerRfvpIpc(manager);
  registerBaseGameIpc();
  registerFileDialogIpc();
  registerProjectDirIpc();

  app.on('will-quit', () => {
    manager.dispose();
  });

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
