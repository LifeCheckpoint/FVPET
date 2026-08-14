/**
 * 文件对话框桥：Electron 下走原生 dialog（window.fileDialog），
 * 纯浏览器下保存退化为 Blob 下载、打开返回 null（由调用方用 input[type=file] 兜底）。
 */

export interface FileDialogBridge {
  saveTextFile(defaultName: string, content: string): Promise<string | null>;
  saveBinaryFile(defaultName: string, content: Uint8Array): Promise<string | null>;
  openTextFile(): Promise<{ name: string; text: string; path?: string } | null>;
}

declare global {
  interface Window {
    readonly fileDialog?: FileDialogBridge;
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

export async function saveTextFile(defaultName: string, content: string): Promise<string | null> {
  if (typeof window !== 'undefined' && window.fileDialog) {
    return window.fileDialog.saveTextFile(defaultName, content);
  }
  downloadBlob(new Blob([content], { type: 'application/json' }), defaultName);
  return null;
}

export async function saveBinaryFile(defaultName: string, content: Uint8Array): Promise<string | null> {
  if (typeof window !== 'undefined' && window.fileDialog) {
    return window.fileDialog.saveBinaryFile(defaultName, content);
  }
  const buffer = new ArrayBuffer(content.byteLength);
  new Uint8Array(buffer).set(content);
  downloadBlob(new Blob([buffer], { type: 'application/octet-stream' }), defaultName);
  return null;
}

export async function openTextFile(): Promise<{ name: string; text: string; path?: string } | null> {
  if (typeof window !== 'undefined' && window.fileDialog) {
    return window.fileDialog.openTextFile();
  }
  return null;
}
