import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 仅用于本地演示壳（pnpm --filter @hcb-editor/ui dev）。
// 注意：hcb 的 NLS 编解码依赖 iconv-lite（Node Buffer），浏览器导出 .hcb 需要
// 额外 node polyfill；导出功能以 Electron 主进程（Node）为目标，演示壳仅用于 UI 校验。
export default defineConfig({
  plugins: [react()],
});
