import type { Preview } from '@storybook/react';
import '@xyflow/react/dist/style.css';
import '../src/theme/tokens.css';
import '../src/styles/ui.css';

/**
 * 全局预览：加载主题 token 与组件样式，story 以暗色为默认底色，
 * 可通过工具栏切换浅色（bg 选择）。主题由 `data-theme` 驱动，
 * 这里固定 dark 以匹配编辑器默认观感。
 */
const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#111318' },
        { name: 'light', value: '#f6f7f8' },
      ],
    },
  },
};

export default preview;
