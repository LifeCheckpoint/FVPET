/**
 * 偏好 React 绑定：读取/更新并持久化编辑器偏好。
 */

import { useCallback, useState } from 'react';
import {
  loadPreferences,
  savePreferences,
  type Preferences,
} from './preferences.js';

export interface PreferencesBinding {
  readonly prefs: Preferences;
  readonly update: (patch: Partial<Preferences>) => void;
}

export function usePreferences(): PreferencesBinding {
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePreferences(next);
      return next;
    });
  }, []);

  return { prefs, update };
}
