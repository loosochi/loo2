import { LAST_LEVEL_ID, LEVELS, getLevel } from '../levels/levelRegistry';
import type { LevelDef } from '../types';
import { EditorStore } from '../editor/EditorStore';
import { Leaderboard } from './Leaderboard';
import { SaveManager, detectStore } from './SaveManager';

/** Level ordering, unlock state and the player's profile (single shared instance). */
export class LevelManager {
  readonly save: SaveManager;
  readonly records: Leaderboard;
  readonly editor: EditorStore;

  constructor(save?: SaveManager, records?: Leaderboard) {
    const store = detectStore();
    this.save = save ?? new SaveManager(LAST_LEVEL_ID, store);
    this.records = records ?? new Leaderboard(store);
    this.editor = new EditorStore(store);
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

  /** Level the PLAY button starts: the tutorial for new players, else the highest unlocked level. */
  playTarget(): number {
    const snap = this.save.snapshot;
    if (snap.unlocked <= 1 && !this.save.progress(0).completed && !this.save.progress(1).completed) return 0;
    return Math.min(snap.unlocked, LAST_LEVEL_ID);
  }

  /** Campaign levels that award stars (everything except the tutorial). */
  get starLevels(): readonly LevelDef[] {
    return LEVELS.filter((l) => l.id > 0);
  }

  get totalStars(): number {
    return this.starLevels.reduce((s, l) => s + this.save.progress(l.id).stars, 0);
  }
}

let instance: LevelManager | null = null;

export function levelManager(): LevelManager {
  instance ??= new LevelManager();
  return instance;
}
