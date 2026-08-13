/**
 * IR schemaVersion 迁移入口。
 * 当前版本为 1：直接校验并返回；未来版本在此按版本号逐级迁移。
 */

import { IR_SCHEMA_VERSION, IrScript, type IrScript as IrScriptT } from './types.js';

export function migrateIrScript(data: unknown): IrScriptT {
  if (typeof data !== 'object' || data === null) {
    throw new Error('IR 数据不是对象');
  }
  const header = (data as { readonly header?: unknown }).header;
  const version = (header as { readonly schemaVersion?: unknown } | undefined)?.schemaVersion;

  if (version === IR_SCHEMA_VERSION) {
    return IrScript.parse(data);
  }
  if (version === undefined) {
    throw new Error('IR 缺少 schemaVersion');
  }
  throw new Error(`不支持的 IR schemaVersion：${String(version)}`);
}
