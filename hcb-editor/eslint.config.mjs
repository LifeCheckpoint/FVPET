import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

// 依赖单向：app → ui → editor → compiler → hcb，rfvp → compiler → hcb。
// 每个包列出它"禁止 import"的上层包；未列出的方向被 lint 拦截。
const layerBans = {
  hcb: ['@hcb-editor/compiler', '@hcb-editor/rfvp', '@hcb-editor/editor', '@hcb-editor/ui', '@hcb-editor/desktop'],
  compiler: ['@hcb-editor/rfvp', '@hcb-editor/editor', '@hcb-editor/ui', '@hcb-editor/desktop'],
  rfvp: ['@hcb-editor/editor', '@hcb-editor/ui', '@hcb-editor/desktop'],
  editor: ['@hcb-editor/rfvp', '@hcb-editor/ui', '@hcb-editor/desktop'],
  ui: ['@hcb-editor/desktop'],
};

function layerConfig(layer, banned) {
  return {
    files: [`packages/${layer}/**/*.ts`, `packages/${layer}/**/*.tsx`],
    rules: {
      'no-restricted-imports': [
        'error',
        ...banned.map((name) => ({
          name,
          message: `依赖方向违规：${layer} 禁止 import ${name}（app → ui → editor → compiler → hcb）`,
        })),
      ],
    },
  };
}

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/storybook-static/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  layerConfig('hcb', layerBans.hcb),
  layerConfig('compiler', layerBans.compiler),
  layerConfig('rfvp', layerBans.rfvp),
  layerConfig('editor', layerBans.editor),
  layerConfig('ui', layerBans.ui),
);
