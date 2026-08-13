import { expect, test, type Page } from '@playwright/test';

/**
 * 冒烟用例：驱动 ui 演示壳（Vite dev），全程走 FakeEngine 兜底，不依赖真实引擎。
 * 每个用例独立启动 → 新建工程 → 操作 → 断言，避免用例间共享状态。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: '新建工程' })).toBeVisible();
  await page.getByRole('button', { name: /创建/ }).click();
  await expect(page.getByRole('dialog', { name: '新建工程' })).toBeHidden();
}

function paletteItem(page: Page, label: string) {
  return page.locator('.palette__item').filter({ hasText: label });
}

test.describe('编辑器冒烟（演示壳 + FakeEngine 兜底）', () => {
  test('启动展示向导，创建后进入空画布', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.app__topbar')).toContainText('FVP 剧情编辑器');
    await expect(page.locator('.flow')).toBeVisible();
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
  });

  test('调色板添加台词节点 → 选中 → 属性面板编辑', async ({ page }) => {
    await boot(page);
    await paletteItem(page, '台词').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(1);

    await page.locator('.react-flow__node').first().click();
    await expect(page.locator('.pp__title')).toHaveText('台词');

    await page.locator('.pp__textarea').fill('樱花树下，再会。');
    await expect(page.locator('.node-card__secondary')).toHaveText('樱花树下，再会。');
  });

  test('撤销 / 重做节点添加', async ({ page }) => {
    await boot(page);
    await paletteItem(page, '旁白').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(1);

    await page.getByRole('button', { name: '撤销' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(0);

    await page.getByRole('button', { name: '重做' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
  });

  test('切换右侧视图（剧本 / 时间线 / 预览）', async ({ page }) => {
    await boot(page);

    await page.getByRole('tab', { name: '剧本' }).click();
    await expect(page.locator('.script')).toBeVisible();

    await page.getByRole('tab', { name: '时间线' }).click();
    await expect(page.locator('.timeline')).toBeVisible();

    await page.getByRole('tab', { name: '预览' }).click();
    await expect(page.locator('.app__tab--active')).toHaveText('预览');
  });

  test('资源管理器可打开并关闭', async ({ page }) => {
    await boot(page);
    await page.locator('.app__topbar').getByRole('button', { name: '资源', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '资源管理器' })).toBeVisible();

    await page.getByRole('dialog', { name: '资源管理器' }).getByRole('button', { name: '关闭' }).click();
    await expect(page.getByRole('dialog', { name: '资源管理器' })).toBeHidden();
  });

  test('设置切换主题为浅色', async ({ page }) => {
    await boot(page);
    await page.locator('.app__topbar').getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();

    await page.locator('.modal__body--form select').first().selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});
