import { expect, test, type Page } from '@playwright/test';

/**
 * 冒烟用例：驱动 ui 演示壳（Vite dev），全程走 FakeEngine 兜底，不依赖真实引擎。
 * 新建工程自带不可删除的 START + 可删的 END 两个节点（label 节点也渲染在画布上）。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.app__empty')).toBeVisible();
  await page.locator('.app__empty-actions').getByRole('button', { name: '新建工程' }).click();
  await expect(page.getByRole('dialog', { name: '新建工程' })).toBeVisible();
  await page.getByRole('button', { name: /创建/ }).click();
  await expect(page.getByRole('dialog', { name: '新建工程' })).toBeHidden();
}

function paletteItem(page: Page, label: string) {
  return page.locator('.palette__item').filter({ hasText: label });
}

test.describe('编辑器冒烟（演示壳 + FakeEngine 兜底）', () => {
  test('启动展示空白占位，新建工程后进入画布（含开始/结束节点）', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.app__topbar')).toContainText('FVP 剧情编辑器');
    await expect(page.locator('.flow')).toBeVisible();
    await expect(page.locator('.react-flow__node')).toHaveCount(2); // START + END
  });

  test('调色板添加台词节点 → 选中 → 属性面板编辑', async ({ page }) => {
    await boot(page);
    await paletteItem(page, '台词').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);

    await page.locator('.react-flow__node').last().click();
    await expect(page.locator('.pp__title')).toHaveText('台词');

    await page.locator('.pp__textarea').fill('樱花树下，再会。');
    await expect(page.locator('.node-card__secondary').last()).toHaveText('樱花树下，再会。');
  });

  test('撤销 / 重做节点添加', async ({ page }) => {
    await boot(page);
    await paletteItem(page, '旁白').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);

    await page.getByRole('button', { name: '撤销' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(2);

    await page.getByRole('button', { name: '重做' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
  });

  test('切换右侧视图（剧本 / 时间线）', async ({ page }) => {
    await boot(page);

    await page.getByRole('tab', { name: '剧本' }).click();
    await expect(page.locator('.script')).toBeVisible();

    await page.getByRole('tab', { name: '时间线' }).click();
    await expect(page.locator('.timeline')).toBeVisible();
  });

  test('资源工作台可打开并返回编辑器', async ({ page }) => {
    await boot(page);
    await page.getByRole('tab', { name: '资源工作台' }).click();
    await expect(page.locator('.workspace')).toBeVisible();

    await page.locator('.workspace__header').getByRole('button', { name: '返回编辑器' }).click();
    await expect(page.locator('.workspace')).toHaveCount(0);
  });

  test('设置切换主题为浅色', async ({ page }) => {
    await boot(page);
    await page.locator('.app__topbar').getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();

    await page.locator('.modal__body--form select').first().selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('右键菜单复制节点', async ({ page }) => {
    await boot(page);
    await paletteItem(page, '台词').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);

    await page.locator('.react-flow__node').last().click({ button: 'right' });
    await expect(page.locator('.flow-context-menu')).toBeVisible();

    await page.getByRole('menuitem', { name: '复制节点' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(4);
  });

  test('整理布局按钮不改变节点数量', async ({ page }) => {
    await boot(page);
    await paletteItem(page, '旁白').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);

    await page.locator('.flow__layout-btn').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
  });
});
