/**
 * 设置界面：统一管理编辑器偏好（主题 / 默认 NLS / 预览比例 / 自动编译 / 资源归档路径）。
 */

import type { Preferences } from '../preferences/preferences.js';
import { openBinaryPath } from '../fileDialog.js';

export interface SettingsProps {
  readonly prefs: Preferences;
  readonly update: (patch: Partial<Preferences>) => void;
  readonly onClose: () => void;
}

async function pickBinPath(onPicked: (path: string) => void): Promise<void> {
  const picked = await openBinaryPath();
  if (picked) {
    onPicked(picked.path);
  }
}

export function Settings({ prefs, update, onClose }: SettingsProps) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="设置">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel">
        <header className="modal__header">
          <span className="modal__title">设置</span>
          <button type="button" className="modal__close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="modal__body modal__body--form">
          <label className="form-row">
            <span className="form-row__label">主题</span>
            <select className="form-row__control" value={prefs.theme} onChange={(e) => update({ theme: e.target.value as Preferences['theme'] })}>
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </label>

          <label className="form-row">
            <span className="form-row__label">默认 NLS</span>
            <select className="form-row__control" value={prefs.defaultNls} onChange={(e) => update({ defaultNls: e.target.value as Preferences['defaultNls'] })}>
              <option value="sjis">sjis</option>
              <option value="gbk">gbk</option>
              <option value="utf8">utf8</option>
            </select>
          </label>

          <label className="form-row">
            <span className="form-row__label">预览画面比例</span>
            <select className="form-row__control" value={prefs.previewRatio} onChange={(e) => update({ previewRatio: e.target.value as Preferences['previewRatio'] })}>
              <option value="4:3">4:3</option>
              <option value="16:9">16:9</option>
            </select>
          </label>

          <label className="form-row form-row--check">
            <span className="form-row__label">自动编译</span>
            <input type="checkbox" checked={prefs.autoCompile} onChange={(e) => update({ autoCompile: e.target.checked })} />
          </label>

          <div className="form-row">
            <span className="form-row__label">graph_bg.bin 归档</span>
            <span className="form-row__path">
              <input
                className="form-row__control"
                type="text"
                value={prefs.graphBgBinPath}
                placeholder="未配置——真实引擎预览需要此归档，请选择文件"
                onChange={(e) => update({ graphBgBinPath: e.target.value })}
              />
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => void pickBinPath((p) => update({ graphBgBinPath: p }))}
              >
                浏览
              </button>
            </span>
          </div>

          <div className="form-row">
            <span className="form-row__label">graph_bs.bin 归档</span>
            <span className="form-row__path">
              <input
                className="form-row__control"
                type="text"
                value={prefs.graphBsBinPath}
                placeholder="未配置——真实引擎预览需要此归档，请选择文件"
                onChange={(e) => update({ graphBsBinPath: e.target.value })}
              />
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => void pickBinPath((p) => update({ graphBsBinPath: p }))}
              >
                浏览
              </button>
            </span>
          </div>
        </div>

        <footer className="modal__footer">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            完成
          </button>
        </footer>
      </div>
    </div>
  );
}
