import { describe, expect, it } from 'vitest';
import {
  addAudio,
  addBackground,
  addBackgrounds,
  addCg,
  addCgs,
  addCharacter,
  applyCommand,
  createProject,
  editCharacter,
  editCharacters,
  emptyState,
  removeCharacter,
} from '@hcb-editor/editor';

describe('createProject', () => {
  it('creates a starter project with the chosen game and nls', () => {
    const project = createProject({ game: 'sakura-moyu', nls: 'sjis' });
    expect(project.header).toEqual({ schemaVersion: 1, engine: 'fvp', game: 'sakura-moyu', nls: 'sjis' });
    expect(project.document.nodes).toHaveLength(2); // START + END
    expect(project.document.startNodeId).toBe('start');
    expect(project.resources.characters).toHaveLength(0);
    expect(project.nextId).toBe(1);
  });

  it('emptyState defaults to the sakura moyu base game', () => {
    const state = emptyState();
    expect(state.header.game).toBe('sakura-moyu');
    expect(state.header.nls).toBe('sjis');
  });
});

describe('resource commands', () => {
  it('adds and edits a character', () => {
    let state = emptyState();
    state = applyCommand(state, addCharacter({ name: 'クロ', speakFn: 0x4, pose: 0, costume: 0, face: 0 })).next;
    expect(state.resources.characters).toHaveLength(1);
    expect(state.resources.characters[0]!.id).toBe('c1');

    const character = state.resources.characters[0]!;
    state = applyCommand(state, editCharacter(character.id, { ...character, name: 'ハル' })).next;
    expect(state.resources.characters[0]!.name).toBe('ハル');
  });

  it('adds a background and an audio entry', () => {
    let state = emptyState();
    state = applyCommand(state, addBackground({ name: '教室', variant: 0, bgFn: null })).next;
    state = applyCommand(state, addAudio({ type: 'bgm', number: 3, label: '日常' })).next;

    expect(state.resources.backgrounds).toHaveLength(1);
    expect(state.resources.backgrounds[0]!.id).toBe('b1');
    expect(state.resources.audios).toHaveLength(1);
    expect(state.resources.audios[0]!.id).toBe('a2');
  });

  it('bulk adds backgrounds in a single command (one undo step)', () => {
    const next = applyCommand(emptyState(), addBackgrounds([
      { name: 'bg_240', variant: 240, bgFn: 226337, image: 'data:image/png;base64,x' },
      { name: 'bg_241', variant: 241, bgFn: 226337 },
    ])).next;

    expect(next.resources.backgrounds).toHaveLength(2);
    expect(next.resources.backgrounds[0]!.name).toBe('bg_240');
    expect(next.resources.backgrounds[0]!.variant).toBe(240);
    expect(next.resources.backgrounds[0]!.bgFn).toBe(226337);
    expect(next.resources.backgrounds[0]!.image).toBe('data:image/png;base64,x');
    expect(next.resources.backgrounds[1]!.name).toBe('bg_241');
  });

  it('bulk adds CGs in a single command', () => {
    let state = emptyState();
    state = applyCommand(state, addCg({ name: 'ASAHI_E011A1', image: 'data:image/png;base64,x' })).next;
    state = applyCommand(state, addCgs([
      { name: 'CHIWA_H01A0', image: 'data:image/png;base64,y' },
      { name: 'KURU_E201A', image: 'data:image/png;base64,z' },
    ])).next;

    expect(state.resources.cgs).toHaveLength(3);
    expect(state.resources.cgs[0]!.id).toBe('g1');
    expect(state.resources.cgs[1]!.name).toBe('CHIWA_H01A0');
    expect(state.resources.cgs[2]!.name).toBe('KURU_E201A');
  });

  it('removes a character by id', () => {
    let state = emptyState();
    state = applyCommand(state, addCharacter({ name: 'クロ', speakFn: null, pose: 0, costume: 0, face: 0 })).next;
    const id = state.resources.characters[0]!.id;
    state = applyCommand(state, removeCharacter(id)).next;
    expect(state.resources.characters).toHaveLength(0);
  });

  it('bulk edits characters in a single command (one undo step)', () => {
    let state = emptyState();
    state = applyCommand(state, addCharacter({ name: 'クロ', speakFn: null, pose: 0, costume: 0, face: 0 })).next;
    state = applyCommand(state, addCharacter({ name: 'ハル', speakFn: null, pose: 0, costume: 0, face: 0 })).next;
    const [a, b] = state.resources.characters;

    const next = applyCommand(state, editCharacters([
      { id: a!.id, character: { ...a!, name: 'クロ改', image: 'data:image/png;base64,x' } },
      { id: b!.id, character: { ...b!, name: 'ハル改', pose: 2 } },
    ])).next;

    expect(next.resources.characters[0]!.name).toBe('クロ改');
    expect(next.resources.characters[0]!.image).toBe('data:image/png;base64,x');
    expect(next.resources.characters[1]!.name).toBe('ハル改');
    expect(next.resources.characters[1]!.pose).toBe(2);
  });
});
