import { describe, expect, it } from 'vitest';
import {
  addAudio,
  addBackground,
  addCharacter,
  applyCommand,
  createProject,
  editCharacter,
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

  it('removes a character by id', () => {
    let state = emptyState();
    state = applyCommand(state, addCharacter({ name: 'クロ', speakFn: null, pose: 0, costume: 0, face: 0 })).next;
    const id = state.resources.characters[0]!.id;
    state = applyCommand(state, removeCharacter(id)).next;
    expect(state.resources.characters).toHaveLength(0);
  });
});
