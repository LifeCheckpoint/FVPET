import { describe, expect, it } from 'vitest';
import { parseBgEntryName } from '../src/resources/graph-bg.js';

describe('parseBgEntryName', () => {
  it('parses a plain background entry', () => {
    expect(parseBgEntryName('BG001_000')).toEqual({ num: 1, variant: 0, blur: false });
  });

  it('parses a night variant', () => {
    expect(parseBgEntryName('BG240_020')).toEqual({ num: 240, variant: 20, blur: false });
  });

  it('flags the b-suffix secondary layer', () => {
    expect(parseBgEntryName('BG001_000b')).toEqual({ num: 1, variant: 0, blur: true });
  });

  it('rejects CG-style names', () => {
    expect(parseBgEntryName('ASAHI_e011a1')).toBeNull();
  });
});
