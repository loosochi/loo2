import { describe, expect, it } from 'vitest';
import { LevelManager } from '../src/systems/LevelManager';
import { MemoryStore, SAVE_KEY, SaveManager, sanitizeSave } from '../src/systems/SaveManager';

describe('SaveManager', () => {
  it('creates a fresh profile when no save exists', () => {
    const store = new MemoryStore();
    const save = new SaveManager(5, store);
    expect(save.snapshot.unlocked).toBe(1);
    expect(save.soundEnabled).toBe(true);
    expect(store.getItem(SAVE_KEY)).not.toBeNull();
  });

  it('recovers from corrupted JSON', () => {
    const store = new MemoryStore();
    store.setItem(SAVE_KEY, '{not json!!');
    const save = new SaveManager(5, store);
    expect(save.recovered).toBe(true);
    expect(save.snapshot.unlocked).toBe(1);
    expect(JSON.parse(store.getItem(SAVE_KEY)!).unlocked).toBe(1);
  });

  it('sanitises invalid fields but keeps valid ones', () => {
    const clean = sanitizeSave({ unlocked: 99, sound: 'yes', levels: { 1: { bestScore: -5, stars: 9, completed: true }, 42: {}, x: 1 } }, 5);
    expect(clean.unlocked).toBe(5);
    expect(clean.sound).toBe(true);
    expect(clean.levels['1']).toEqual({ bestScore: 0, stars: 5, completed: true });
    expect(Object.keys(clean.levels)).toEqual(['1']);
  });

  it('unlocks the next level on a win and keeps best results', () => {
    const store = new MemoryStore();
    const save = new SaveManager(5, store);
    expect(save.isUnlocked(2)).toBe(false);
    save.recordResult(1, false, 100, 0);
    expect(save.isUnlocked(2)).toBe(false);
    expect(save.recordResult(1, true, 1500, 3)).toBe(true);
    expect(save.isUnlocked(2)).toBe(true);
    expect(save.recordResult(1, true, 900, 2)).toBe(false);
    expect(save.progress(1)).toEqual({ bestScore: 1500, stars: 3, completed: true });
  });

  it('persists progress and settings across sessions (reload from storage)', () => {
    const store = new MemoryStore();
    const a = new SaveManager(5, store);
    a.recordResult(1, true, 1200, 4);
    a.recordResult(2, true, 1800, 2);
    a.setSound(false);
    a.setLastLevel(3);
    const b = new SaveManager(5, store);
    expect(b.snapshot.unlocked).toBe(3);
    expect(b.progress(1).stars).toBe(4);
    expect(b.progress(2).bestScore).toBe(1800);
    expect(b.soundEnabled).toBe(false);
    expect(b.snapshot.lastLevel).toBe(3);
    const lm = new LevelManager(b);
    expect(lm.playTarget()).toBe(3);
    expect(lm.totalStars).toBe(6);
  });

  it('does not unlock beyond the last level and can reset', () => {
    const store = new MemoryStore();
    const save = new SaveManager(2, store);
    save.recordResult(2, true, 10, 1);
    save.recordResult(1, true, 10, 1);
    expect(save.snapshot.unlocked).toBe(2);
    save.reset();
    expect(save.snapshot.unlocked).toBe(1);
    expect(save.progress(1).stars).toBe(0);
  });
});
