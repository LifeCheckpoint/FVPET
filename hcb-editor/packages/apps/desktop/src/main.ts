/**
 * Electron 薄壳主进程：仅用于「初步界面了解」——加载 ui 包的 Vite 演示壳。
 * 真实引擎（rfvp-cli + RfvpProcessManager + 真实 Event 回放）在 S4 解冻后接入；
 * 此阶段不引入 preload/contextBridge，渲染层继续走 FakeEngine 兜底。
 */

import { app, BrowserWindow } from 'electron';

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
    },
  });

  await loadWithRetry(win, DEV_URL);
}

void app.whenReady().then(async () => {
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
