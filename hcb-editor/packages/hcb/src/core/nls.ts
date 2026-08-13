/**
 * NLS 编码（sjis / gbk / utf8）。
 * 对应 hcb_ir_core.py 的 NLS_CODECS / norm_nls / decode_cstring / encode_cstring。
 * 约定：gbk 统一按 gb18030 处理（与 Python 侧 NLS_CODECS['gbk'] = 'gb18030' 一致）。
 */

import { Buffer } from 'buffer';
import iconv from 'iconv-lite';

export type Nls = 'sjis' | 'gbk' | 'utf8';

export function normalizeNls(nls?: string): Nls {
  const key = (nls ?? 'sjis').toLowerCase().replace(/\s+/g, '');
  if (key === 'sjis' || key === 'shiftjis' || key === 'shift-jis' || key === 'shift_jis') {
    return 'sjis';
  }
  if (key === 'gbk' || key === 'gb2312' || key === 'gb18030') {
    return 'gbk';
  }
  if (key === 'utf8' || key === 'utf-8') {
    return 'utf8';
  }
  throw new Error(`unknown nls: ${nls}`);
}

const ICONV_LABEL: Record<Nls, string> = {
  sjis: 'shift_jis',
  gbk: 'gb18030',
  utf8: 'utf8',
};

/** 解码 C 字符串（以 NUL 结尾，长度字节含 NUL）。 */
export function decodeCString(rawWithNul: Uint8Array, nls: Nls): string {
  const end = rawWithNul.indexOf(0);
  const raw = end < 0 ? rawWithNul : rawWithNul.subarray(0, end);
  return iconv.decode(Buffer.from(raw), ICONV_LABEL[nls]);
}

/** 编码 C 字符串（含结尾 NUL）；长度必须 <= 255 字节。 */
export function encodeCString(text: string, nls: Nls): Uint8Array {
  const buf = iconv.encode(`${text}\0`, ICONV_LABEL[nls]);
  if (buf.length > 255) {
    throw new Error(`C string too long for HCB u8 length: ${buf.length} bytes including NUL`);
  }
  return new Uint8Array(buf);
}

/** 文本未修改时保留原字节；已修改时按 nls 重编码（含 NUL）。 */
export function rawOrEncoded(text: string, original: string, raw: Uint8Array, nls: Nls): Uint8Array {
  if (raw.length > 0 && text === original) {
    return raw;
  }
  return encodeCString(text, nls);
}
