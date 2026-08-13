/**
 * 工程目录桥：Electron 下工程保存为「目录」（project.json + assets/），
 * 资源文件落盘；纯浏览器下退回单文件 JSON（data URL 内嵌）。
 */

import { deserializeProjectFromDir, serializeProject, serializeProjectToDir, type EditorState } from '@hcb-editor/editor';

export interface ProjectDirAsset {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface ProjectDirBridge {
  save(defaultName: string, projectJson: string, assets: ProjectDirAsset[]): Promise<string | null>;
  /** 静默保存到已知目录（自动保存用，不弹对话框）。 */
  saveAs(dir: string, projectJson: string, assets: ProjectDirAsset[]): Promise<string>;
  open(): Promise<{ projectJson: string; assets: ProjectDirAsset[] } | null>;
}

declare global {
  interface Window {
    readonly projectDir?: ProjectDirBridge;
  }
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 保存工程为目录（Electron）；浏览器退回单文件 JSON。返回保存位置（浏览器为 null）。 */
export async function saveProjectDir(state: EditorState): Promise<string | null> {
  if (typeof window !== 'undefined' && window.projectDir) {
    const { projectJson, assets } = serializeProjectToDir(state);
    return window.projectDir.save('my-project', projectJson, assets.map((a) => ({ ...a })));
  }
  downloadBlob(
    new Blob([serializeProject(state)], { type: 'application/json' }),
    'project.hcbproj.json',
  );
  return null;
}

/** 静默保存到已知目录（自动保存用，Electron 专有）。 */
export async function saveProjectDirAs(dir: string, state: EditorState): Promise<string> {
  if (typeof window !== 'undefined' && window.projectDir) {
    const { projectJson, assets } = serializeProjectToDir(state);
    return window.projectDir.saveAs(dir, projectJson, assets.map((a) => ({ ...a })));
  }
  throw new Error('当前环境不支持目录保存（仅 Electron 支持自动保存）');
}

/** 打开工程目录（Electron）；浏览器返回 null（调用方用 input[type=file] 兜底）。 */
export async function openProjectDir(): Promise<EditorState | null> {
  if (typeof window !== 'undefined' && window.projectDir) {
    const result = await window.projectDir.open();
    if (result) {
      return deserializeProjectFromDir(result.projectJson, result.assets);
    }
  }
  return null;
}
