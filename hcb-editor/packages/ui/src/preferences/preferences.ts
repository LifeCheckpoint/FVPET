/**
 * 编辑器偏好：主题 / 默认 NLS / 预览比例 / 自动编译 / 资源归档路径。
 * 持久化到 localStorage（键名 hcb-editor:preferences）。
 */

export type ThemePreference = 'dark' | 'light';
export type NlsPreference = 'sjis' | 'gbk' | 'utf8';
export type PreviewRatio = '4:3' | '16:9';

export interface Preferences {
  readonly theme: ThemePreference;
  readonly defaultNls: NlsPreference;
  readonly previewRatio: PreviewRatio;
  readonly autoCompile: boolean;
  /** 真实引擎预览读取背景图归档（graph_bg.bin）的本地路径，空串表示未配置。 */
  readonly graphBgBinPath: string;
  /** 真实引擎预览读取立绘归档（graph_bs.bin）的本地路径，空串表示未配置。 */
  readonly graphBsBinPath: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark',
  defaultNls: 'gbk',
  previewRatio: '4:3',
  autoCompile: false,
  graphBgBinPath: '',
  graphBsBinPath: '',
};

const STORAGE_KEY = 'hcb-editor:preferences';

export function loadPreferences(): Preferences {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_PREFERENCES;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PREFERENCES;
    }
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: Preferences): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // 存储不可用时静默降级。
  }
}

/**
 * 从已配置的资源归档路径推导真实引擎资源根目录：取第一个非空路径的父目录。
 * 兼容 `/` 与 `\` 分隔符；两个都为空时返回 `''`。
 */
export function deriveResourceRoot(graphBgBinPath: string, graphBsBinPath: string): string {
  const first = [graphBgBinPath, graphBsBinPath].find((p) => p.trim() !== '');
  if (!first) {
    return '';
  }
  return first.split(/[\\/]/).slice(0, -1).join('/');
}
