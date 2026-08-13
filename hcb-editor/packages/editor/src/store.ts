/**
 * EditorStore：命令分发 + undo/redo 栈（Immer patches 对）+ 订阅通知。
 * undo 栈与 redo 栈各存 { patches, inversePatches } 对：
 * - undo：apply inversePatches，压回 redo 栈。
 * - redo：apply patches，压回 undo 栈。
 * - subscribe：UI 通过 useSyncExternalStore 订阅状态变化（状态引用不可变替换）。
 */

import { applyPatches, type Patch } from 'immer';
import type { EditorState } from './state.js';
import { applyCommand, type Command } from './commands.js';

interface PatchPair {
  readonly patches: Patch[];
  readonly inversePatches: Patch[];
}

export type StoreListener = () => void;

export class EditorStore {
  private state: EditorState;
  private undoStack: PatchPair[] = [];
  private redoStack: PatchPair[] = [];
  private listeners = new Set<StoreListener>();

  constructor(initial: EditorState) {
    this.state = initial;
  }

  get current(): EditorState {
    return this.state;
  }

  /** 订阅状态变化，返回取消订阅函数。状态引用只在变更时替换，保证快照稳定。 */
  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispatch(cmd: Command): void {
    const { next, patches, inversePatches } = applyCommand(this.state, cmd);
    this.state = next;
    this.undoStack.push({ patches, inversePatches });
    this.redoStack = [];
    this.emit();
  }

  /** 整体载入工程（新建 / 打开），清空撤销历史。 */
  load(state: EditorState): void {
    this.state = state;
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  undo(): boolean {
    const pair = this.undoStack.pop();
    if (!pair) {
      return false;
    }
    this.state = applyPatches(this.state, pair.inversePatches);
    this.redoStack.push(pair);
    this.emit();
    return true;
  }

  redo(): boolean {
    const pair = this.redoStack.pop();
    if (!pair) {
      return false;
    }
    this.state = applyPatches(this.state, pair.patches);
    this.undoStack.push(pair);
    this.emit();
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
