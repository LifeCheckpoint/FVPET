import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook 配置（组件库）：只收集 src 下的 *.stories.tsx。
 * 使用 react-vite 框架，与演示壳共享同一套 Vite 解析（workspace 依赖直接走源码导出）。
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
};

export default config;
