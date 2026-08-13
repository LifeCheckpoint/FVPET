/**
 * React 绑定：把 headless EditorStore 接到 useSyncExternalStore。
 * 状态引用不可变替换，订阅后 dispatch/undo/redo 触发重渲染。
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { EditorStore, emptyState, type EditorState } from '@hcb-editor/editor';

export interface EditorStoreBinding {
  readonly store: EditorStore;
  readonly state: EditorState;
}

export function useEditorStore(initial?: EditorState): EditorStoreBinding {
  const storeRef = useRef<EditorStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = new EditorStore(initial ?? emptyState());
  }
  const store = storeRef.current;

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  );
  const state = useSyncExternalStore(subscribe, () => store.current);

  return { store, state };
}
