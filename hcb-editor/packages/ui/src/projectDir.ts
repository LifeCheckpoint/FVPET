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
