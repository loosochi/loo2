/**
 * Records table: the best results per level.
 *
 * Always kept locally (localStorage). When the page runs as a published claude.ai artifact
 * that has been granted a shared database, results are also shared with everyone who plays
 * the page; otherwise the shared part simply stays off.
 */
import type { KeyValueStore } from './SaveManager';
import { MemoryStore } from './SaveManager';

export interface RecordEntry {
  id: string;
  name: string;
  score: number;
  stars: number;
  /** Seconds taken. */
  time: number;
  /** ISO date (yyyy-mm-dd). */
  date: string;
}

export const RECORDS_KEY = 'traffic-flow.records';
export const RECORDS_LIMIT = 10;

/** Better result first: higher score, then faster time. */
export function compareRecords(a: RecordEntry, b: RecordEntry): number {
  return b.score - a.score || a.time - b.time;
}

function isEntry(v: unknown): v is RecordEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.name === 'string' &&
    typeof e.score === 'number' &&
    Number.isFinite(e.score) &&
    typeof e.stars === 'number' &&
    typeof e.time === 'number' &&
    typeof e.date === 'string'
  );
}

/** Minimal slice of the artifact `db` capability we use. */
interface SharedDb {
  collection(path: string): {
    doc(id?: string): { set(data: Record<string, unknown>): Promise<void> };
    orderBy(field: string, dir?: 'asc' | 'desc'): { limit(n: number): { get(): Promise<{ docs: { data(): Record<string, unknown> | undefined }[] }> } };
  };
}

export class Leaderboard {
  private data: Record<string, RecordEntry[]> = {};
  private sharedDb: Promise<SharedDb | null> | null = null;

  constructor(private readonly store: KeyValueStore = new MemoryStore()) {
    this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(this.store.getItem(RECORDS_KEY) ?? '{}') as unknown;
      if (raw && typeof raw === 'object') {
        for (const [k, list] of Object.entries(raw as Record<string, unknown>)) {
          if (Array.isArray(list)) this.data[k] = list.filter(isEntry).sort(compareRecords).slice(0, RECORDS_LIMIT);
        }
      }
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    try {
      this.store.setItem(RECORDS_KEY, JSON.stringify(this.data));
    } catch {
      /* storage full or blocked */
    }
  }

  /** Local top results for a level, best first. */
  local(levelId: number): RecordEntry[] {
    return [...(this.data[String(levelId)] ?? [])];
  }

  /**
   * Add a result. Returns its 1-based place in the local table, or null if it did not make
   * the top ten. Also sends it to the shared table when one is available.
   */
  submit(levelId: number, entry: Omit<RecordEntry, 'id' | 'date'> & { date?: string }): { rank: number | null; entry: RecordEntry } {
    const full: RecordEntry = {
      ...entry,
      name: entry.name || 'Player',
      id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      date: entry.date ?? new Date().toISOString().slice(0, 10),
    };
    const list = [...this.local(levelId), full].sort(compareRecords);
    const idx = list.indexOf(full);
    this.data[String(levelId)] = list.slice(0, RECORDS_LIMIT);
    this.save();
    void this.pushShared(levelId, full);
    return { rank: idx < RECORDS_LIMIT ? idx + 1 : null, entry: full };
  }

  clear(): void {
    this.data = {};
    this.save();
  }

  // ---------------------------------------------------------------- shared (optional)

  private shared(): Promise<SharedDb | null> {
    if (!this.sharedDb) {
      const claude = (globalThis as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
      this.sharedDb =
        claude && typeof claude.use === 'function'
          ? claude
              .use('db')
              .then((db) => (db as SharedDb | null) ?? null)
              .catch(() => null)
          : Promise.resolve(null);
    }
    return this.sharedDb;
  }

  /** Top shared results, or null when there is no shared table in this view. */
  async sharedTop(levelId: number): Promise<RecordEntry[] | null> {
    const db = await this.shared();
    if (!db) return null;
    try {
      const snap = await db.collection(`records-L${levelId}`).orderBy('score', 'desc').limit(50).get();
      return snap.docs
        .map((d) => d.data() as unknown)
        .filter(isEntry)
        .sort(compareRecords)
        .slice(0, RECORDS_LIMIT);
    } catch {
      return null;
    }
  }

  private async pushShared(levelId: number, e: RecordEntry): Promise<void> {
    const db = await this.shared();
    if (!db) return;
    try {
      await db.collection(`records-L${levelId}`).doc(e.id).set({ ...e });
    } catch {
      /* read-only viewer or quota: the local table still has it */
    }
  }
}
