/**
 * 新建工程向导：选底座游戏（继承函数库/syscall 导入表）+ 默认 NLS，生成空剧情骨架。
 */

import { useState } from 'react';
import { BASE_GAMES, createProject, type EditorStore } from '@hcb-editor/editor';
import type { NlsPreference } from '../preferences/preferences.js';

export interface NewProjectWizardProps {
  readonly store: EditorStore;
  readonly defaultNls: NlsPreference;
  readonly onClose: () => void;
}

export function NewProjectWizard({ store, defaultNls, onClose }: NewProjectWizardProps) {
  const [game, setGame] = useState(BASE_GAMES[0]!.id);
  const [nls, setNls] = useState<NlsPreference>(defaultNls);

  const create = () => {
    store.load(createProject({ game, nls }));
    onClose();
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="新建工程">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel">
        <header className="modal__header">
          <span className="modal__title">新建工程</span>
        </header>

        <div className="modal__body modal__body--form">
          <label className="form-row">
            <span className="form-row__label">底座游戏</span>
            <select className="form-row__control" value={game} onChange={(e) => setGame(e.target.value)}>
              {BASE_GAMES.map((g) => (
                <option value={g.id} key={g.id}>{g.label}</option>
              ))}
            </select>
          </label>

          <label className="form-row">
            <span className="form-row__label">默认 NLS</span>
            <select className="form-row__control" value={nls} onChange={(e) => setNls(e.target.value as NlsPreference)}>
              <option value="sjis">sjis</option>
              <option value="gbk">gbk</option>
              <option value="utf8">utf8</option>
            </select>
          </label>

          <div className="form-hint">底座游戏提供已有角色 / 背景的函数地址映射，新工程继承其函数库与 syscall 导入表。</div>
        </div>

        <footer className="modal__footer">
          <button type="button" className="btn btn--secondary" onClick={onClose}>取消</button>
          <button type="button" className="btn btn--primary" onClick={create}>创建</button>
        </footer>
      </div>
    </div>
  );
}
