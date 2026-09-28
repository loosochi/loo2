import type { Lang } from '../types';

/** Persistent player profile stored in localStorage (with validation and safe fallbacks). */

export interface LevelProgress {
  bestScore: number;
  stars: number;
  completed: boolean;
}

export interface SaveData {
  version: number;
  /** Highest unlocked level id. */
  unlocked: number;
  levels: Record<string, LevelProgress>;
  sound: boolean;
  lastLevel: number;
  /** Interface language; null = follow the browser. */
  lang: Lang | null;
  /** Name shown in the records table. */
  playerName: string;
}

export const SAVE_KEY = 'traffic-flow.save';
export const SAVE_VERSION = 1;

/** Minimal Storage interface so tests can inject an in-memory store. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

export function defaultSave(): SaveData {
  return { version: SAVE_VERSION, unlocked: 1, levels: {}, sound: true, lastLevel: 0, lang: null, playerName: '' };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validate untrusted data, keeping whatever is usable and defaulting the rest. */
/** Clean up a player name: printable, trimmed, at most 16 characters. */
export function cleanName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 16);
}

/**
 * Validate untrusted data, keeping whatever is usable and defaulting the rest.
 * `maxLevel` is the id of the last level (level 0 is the tutorial).
 */
export function sanitizeSave(raw: unknown, maxLevel: number): SaveData {
  const base = defaultSave();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const clampLevel = (n: number, min: number) => Math.max(min, Math.min(maxLevel, Math.floor(n)));
  const out: SaveData = {
    version: SAVE_VERSION,
    unlocked: isFiniteNumber(r.unlocked) ? clampLevel(r.unlocked, 1) : base.unlocked,
    levels: {},
    sound: typeof r.sound === 'boolean' ? r.sound : base.sound,
    lastLevel: isFiniteNumber(r.lastLevel) ? clampLevel(r.lastLevel, 0) : base.lastLevel,
    lang: r.lang === 'en' || r.lang === 'ru' ? r.lang : null,
    playerName: typeof r.playerName === 'string' ? cleanName(r.playerName) : '',
  };
  if (r.levels && typeof r.levels === 'object') {
    for (const [k, v] of Object.entries(r.levels as Record<string, unknown>)) {
      const id = Number(k);
      if (!Number.isInteger(id) || id < 0 || id > maxLevel || !v || typeof v !== 'object') continue;
      const p = v as Record<string, unknown>;
      out.levels[k] = {
        bestScore: isFiniteNumber(p.bestScore) ? Math.max(0, Math.round(p.bestScore)) : 0,
        stars: isFiniteNumber(p.stars) ? Math.max(0, Math.min(5, Math.round(p.stars))) : 0,
        completed: p.completed === true,
      };
    }
  }
  if (out.lastLevel > out.unlocked) out.lastLevel = out.unlocked;
  return out;
}

export function detectStore(): KeyValueStore {
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      const probe = '__tf_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    }
  } catch {
    /* private mode or blocked storage: fall back to memory */
  }
  return new MemoryStore();
}

export class SaveManager {
  private data: SaveData;
  /** True if an existing save was unreadable and a fresh profile was created. */
  recovered = false;

  constructor(
    private readonly maxLevel: number,
    private readonly store: KeyValueStore = detectStore(),
  ) {
    this.data = this.load();
  }

  private load(): SaveData {
    let text: string | null = null;
    try {
      text = this.store.getItem(SAVE_KEY);
    } catch {
      text = null;
    }
    if (text === null) {
      const fresh = defaultSave();
      this.write(fresh);
      return fresh;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      const clean = sanitizeSave(parsed, this.maxLevel);
      if (!parsed || typeof parsed !== 'object') this.recovered = true;
      this.write(clean);
      return clean;
    } catch {
      this.recovered = true;
      const fresh = defaultSave();
      this.write(fresh);
      return fresh;
    }
  }

  private write(d: SaveData): void {
    try {
      this.store.setItem(SAVE_KEY, JSON.stringify(d));
    } catch {
      /* quota exceeded or storage unavailable — progress stays in memory */
    }
  }

  get snapshot(): Readonly<SaveData> {
    return this.data;
  }

  /** The tutorial (0) is always open; others up to the highest unlocked id. */
  isUnlocked(levelId: number): boolean {
    return levelId >= 0 && levelId <= this.data.unlocked;
  }

  progress(levelId: number): LevelProgress {
    return this.data.levels[String(levelId)] ?? { bestScore: 0, stars: 0, completed: false };
  }

  get soundEnabled(): boolean {
    return this.data.sound;
  }

  setSound(on: boolean): void {
    this.data.sound = on;
    this.write(this.data);
  }

  get lang(): Lang | null {
    return this.data.lang;
  }

  setLang(lang: Lang | null): void {
    this.data.lang = lang;
    this.write(this.data);
  }

  get playerName(): string {
    return this.data.playerName;
  }

  setPlayerName(name: string): void {
    this.data.playerName = cleanName(name);
    this.write(this.data);
  }

  setLastLevel(levelId: number): void {
    if (!this.isUnlocked(levelId)) return;
    this.data.lastLevel = levelId;
    this.write(this.data);
  }

  /** Record a finished attempt. Wins unlock the next level. Returns true on a new best score. */
  recordResult(levelId: number, win: boolean, score: number, stars: number): boolean {
    const prev = this.progress(levelId);
    let newBest = false;
    if (win) {
      newBest = score > prev.bestScore;
      this.data.levels[String(levelId)] = {
        bestScore: Math.max(prev.bestScore, Math.round(score)),
        stars: Math.max(prev.stars, stars),
        completed: true,
      };
      if (levelId + 1 <= this.maxLevel && this.data.unlocked < levelId + 1) this.data.unlocked = levelId + 1;
    }
    this.write(this.data);
    return newBest;
  }

  reset(): void {
    const { sound, lang, playerName } = this.data;
    this.data = { ...defaultSave(), sound, lang, playerName };
    this.write(this.data);
  }
}
