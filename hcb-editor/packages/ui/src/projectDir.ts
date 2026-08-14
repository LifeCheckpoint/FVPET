/**
 * 工程目录桥：Electron 下工程保存为「目录」（project.json + assets/），
 * 资源以相对路径引用 + fvpet-asset:// 协议按需加载；纯浏览器下退回单文件 JSON（data URL 内嵌）。
 */

import {
  deserializeProjectFromDir,
  planProjectSave,
  serializeProject,
  type EditorState,
} from '@hcb-editor/editor';

export interface ProjectDirAsset {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface ProjectDirBridge {
  save(
    defaultName: string,
    projectJson: string,
    dirtyAssets: ProjectDirAsset[],
    referencedPaths: string[],
  ): Promise<string | null>;
  saveAs(
    dir: string,
    projectJson: string,
    dirtyAssets: ProjectDirAsset[],
    referencedPaths: string[],
  ): Promise<string>;
  open(): Promise<{ projectJson: string; dir: string } | null>;
}

declare global {
  interface Window {
    readonly projectDir?: ProjectDirBridge;
  }
}

/** 当前活动工程目录绝对路径（打开/保存成功后设置，供 assetUrl 解析）。 */
let activeProjectDir: string | null = null;

export function setActiveProjectDir(dir: string | null): void {
  activeProjectDir = dir;
}

export function getActiveProjectDir(): string | null {
  return activeProjectDir;
}

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 把资源引用解析为可加载 URL：
 * - data URL / 绝对 URL 原样返回；
 * - 相对路径引用 → fvpet-asset://asset/<base64url(工程目录)>/<路径>（Electron）；
 * - 无活动工程目录（浏览器）时保持原值，调用方自行兜底。
 */
export function assetUrl(ref: string | undefined): string | undefined {
  if (!ref) {
    return ref;
  }
  if (ref.startsWith('data:') || /^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) {
    return ref;
  }
  const dir = activeProjectDir;
  if (!dir) {
    return ref;
  }
  const encoded = toBase64Url(dir);
  const rel = ref.split('/').map(encodeURIComponent).join('/');
  return `fvpet-asset://asset/${encoded}/${rel}`;
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface SaveOutcome {
  readonly path: string | null;
  readonly refs: Readonly<Record<string, string>>;
}

function cloneAssets(
  assets: readonly { readonly path: string; readonly bytes: Uint8Array }[],
): ProjectDirAsset[] {
  return assets.map((a) => ({ path: a.path, bytes: a.bytes }));
}

/** 保存工程为目录（Electron）；浏览器退回单文件 JSON。返回保存位置与 data URL→引用映射。 */
export async function saveProjectDir(state: EditorState): Promise<SaveOutcome> {
  if (typeof window !== 'undefined' && window.projectDir) {
    const { projectJson, dirtyAssets, referencedPaths, refs } = planProjectSave(state);
    const path = await window.projectDir.save(
      'my-project',
      projectJson,
      cloneAssets(dirtyAssets),
      [...referencedPaths],
    );
    return { path, refs };
  }
  downloadBlob(
    new Blob([serializeProject(state)], { type: 'application/json' }),
    'project.hcbproj.json',
  );
  return { path: null, refs: {} };
}

/** 静默保存到已知目录（自动保存 / 写回原目录）。返回 data URL→引用映射。 */
export async function saveProjectDirAs(
  dir: string,
  state: EditorState,
): Promise<Readonly<Record<string, string>>> {
  if (typeof window !== 'undefined' && window.projectDir) {
    const { projectJson, dirtyAssets, referencedPaths, refs } = planProjectSave(state);
    await window.projectDir.saveAs(dir, projectJson, cloneAssets(dirtyAssets), [...referencedPaths]);
    return refs;
  }
  throw new Error('当前环境不支持目录保存（仅 Electron 支持自动保存）');
}

/** 打开工程目录（Electron）；浏览器返回 null（调用方用 input[type=file] 兜底）。 */
export async function openProjectDir(): Promise<EditorState | null> {
  if (typeof window !== 'undefined' && window.projectDir) {
    const result = await window.projectDir.open();
    if (result) {
      setActiveProjectDir(result.dir);
      return deserializeProjectFromDir(result.projectJson);
    }
  }
  return null;
}
