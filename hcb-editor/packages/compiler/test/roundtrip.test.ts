import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeNls } from '@hcb-editor/hcb/core';
import { decodeHcb } from '@hcb-editor/hcb/decompile';
import { encodeFromFlat } from '@hcb-editor/compiler/passes';

/**
 * 本地 round-trip 验证（临时）：直接读参考仓库 HCB，不提交进仓库。
 * M1-8 正式阶段以 fixtures/ 下的合成夹具替代。
 */
describe('hcb round-trip (local reference fixtures)', () => {
  it('Sakura.hcb decodes and re-encodes byte-identically', () => {
    const data = new Uint8Array(
      readFileSync('../../../.reference_repo/fvpanalysis/hcbtool_test/Sakura.hcb'),
    );
    const nls = normalizeNls('sjis');
    const decoded = decodeHcb(data, nls);
    const encoded = encodeFromFlat(decoded.instructions, decoded.sysdesc, nls);

    expect(decoded.instructions.length).toBeGreaterThan(0);
    expect(Buffer.from(encoded).equals(Buffer.from(data))).toBe(true);
  });
});
