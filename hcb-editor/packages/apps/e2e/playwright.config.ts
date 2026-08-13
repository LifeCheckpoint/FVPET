import { defineConfig, devices } from '@playwright/test';

/**
 * 端到端：驱动 ui 包的 Vite 演示壳（FakeEngine 兜底，无真实引擎依赖）。
 * webServer 启动 `pnpm --filter @hcb-editor/ui run dev:test`（固定 5199 端口）。
 */
export default defineConfig({
  testDir: './src',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5199',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm run dev:test',
    cwd: '../../ui',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
