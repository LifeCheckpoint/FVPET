import { describe, expect, it } from 'vitest';
import { parseGraphEntryName } from '../src/resources/graph-bs.js';

describe('parseGraphEntryName', () => {
  it('parses a base entry', () => {
    expect(parseGraphEntryName('CHR_あさひ_基_私服')).toEqual({
      character: 'あさひ',
      pose: '基',
      costume: '私服',
      size: '',
      faceSheet: false,
    });
  });

  it('parses a costume containing underscores', () => {
    expect(parseGraphEntryName('CHR_クロ_基_私服_ネコ')).toEqual({
      character: 'クロ',
      pose: '基',
      costume: '私服_ネコ',
      size: '',
      faceSheet: false,
    });
  });

  it('detects the face-sheet suffix', () => {
    expect(parseGraphEntryName('CHR_あさひ_基_私服_表情')).toEqual({
      character: 'あさひ',
      pose: '基',
      costume: '私服',
      size: '',
      faceSheet: true,
    });
  });

  it('strips the L/U size variant', () => {
    expect(parseGraphEntryName('CHR_あさひ_基_私服L')).toEqual({
      character: 'あさひ',
      pose: '基',
      costume: '私服',
      size: 'L',
      faceSheet: false,
    });
    expect(parseGraphEntryName('CHR_ハル_基_制服U_表情')).toEqual({
      character: 'ハル',
      pose: '基',
      costume: '制服',
      size: 'U',
      faceSheet: true,
    });
  });

  it('rejects non-CHR names', () => {
    expect(parseGraphEntryName('bg_240')).toBeNull();
    expect(parseGraphEntryName('CHR_只有两个字')).toBeNull();
  });
});
