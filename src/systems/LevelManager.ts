import { LEVELS, getLevel } from '../levels/levelRegistry';
import type { LevelDef } from '../types';
import { SaveManager } from './SaveManager';

/** Level ordering, unlock state and the player's profile (single shared instance). */
export class LevelManager {
  readonly save: SaveManager;

  constructor(save?: SaveManager) {
    this.save = save ?? new SaveManager(LEVELS.length);
  }

  get levels(): readonly LevelDef[] {
    return LEVELS;
  }

  get(id: number): LevelDef | undefined {
    return getLevel(id);
  }

  next(id: number): LevelDef | undefined {
    return getLevel(id + 1);
  }

  isUnlocked(id: number): boolean {
    return this.save.isUnlocked(id);
  }

  /** Level the PLAY button starts: the highest unlocked level. */
  playTarget(): number {
    return Math.min(this.save.snapshot.unlocked, LEVELS.length);
  }

  get totalStars(): number {
    return LEVELS.reduce((s, l) => s + this.save.progress(l.id).stars, 0);
  }
}

let instance: LevelManager | null = null;

export function levelManager(): LevelManager {
  instance ??= new LevelManager();
  return instance;
}
