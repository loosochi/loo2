import type { KeyValueStore } from '../systems/SaveManager';
import { defaultEditorLevel, sanitizeEditorLevel, type EditorLevel } from './EditorModel';

export const EDITOR_KEY = 'traffic-flow.editor';
export const SLOT_COUNT = 3;

/** Three save slots for custom levels, kept in localStorage. */
export class EditorStore {
  private slots: (EditorLevel | null)[] = new Array(SLOT_COUNT).fill(null);
  current = 0;

  constructor(private readonly store: KeyValueStore) {
    try {
      const raw = JSON.parse(store.getItem(EDITOR_KEY) ?? 'null') as { slots?: unknown[]; current?: unknown } | null;
      if (raw && Array.isArray(raw.slots)) {
        this.slots = Array.from({ length: SLOT_COUNT }, (_, i) => sanitizeEditorLevel(raw.slots![i]));
      }
      if (typeof raw?.current === 'number' && raw.current >= 0 && raw.current < SLOT_COUNT) this.current = raw.current;
    } catch {
      /* corrupted: start empty */
    }
  }

  /** Level in a slot (a fresh default when empty). */
  load(slot: number, defaultName: string): EditorLevel {
    return structuredClone(this.slots[slot] ?? defaultEditorLevel(defaultName));
  }

  save(slot: number, level: EditorLevel): void {
    this.slots[slot] = structuredClone(level);
    this.current = slot;
    try {
      this.store.setItem(EDITOR_KEY, JSON.stringify({ slots: this.slots, current: this.current }));
    } catch {
      /* storage unavailable */
    }
  }
}
