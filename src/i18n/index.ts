/**
 * Minimal localisation: flat string tables for English and Russian with `{param}` interpolation.
 */
import type { Lang, LevelDef, LocalizedText, StarCheck, VehicleKind } from '../types';
import { en } from './en';
import { ru } from './ru';

export type Key = keyof typeof en;
export type { Lang };

const TABLES: Record<Lang, Record<Key, string>> = { en, ru };
export const LANGS: readonly Lang[] = ['en', 'ru'];

let current: Lang = detectLang();
const listeners = new Set<(l: Lang) => void>();

/** Browser language → supported language (Russian for ru/be/uk/kk, English otherwise). */
export function detectLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return /^(ru|be|uk|kk)\b/i.test(nav) ? 'ru' : 'en';
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  for (const fn of listeners) fn(lang);
}

export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Translate a key, replacing `{name}` placeholders. Falls back to English. */
export function t(key: Key, params: Record<string, string | number> = {}): string {
  const raw = TABLES[current][key] ?? en[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

export function localized(text: LocalizedText): string {
  return text[current] ?? text.en;
}

export function levelName(level: LevelDef): string {
  return current === 'ru' && level.ru ? level.ru.name : level.name;
}

export function levelDescription(level: LevelDef): string {
  return current === 'ru' && level.ru ? level.ru.description : level.description;
}

export function levelHint(level: LevelDef): string | undefined {
  if (current === 'ru' && level.ru) return level.ru.hint ?? level.ru.description;
  return level.hint ?? level.description;
}

/** "LEVEL 3" / "TUTORIAL" / "CUSTOM" label for a level. */
export function levelLabel(level: LevelDef): string {
  if (level.custom) return t('hud.custom');
  if (level.id === 0) return t('hud.tutorial');
  // Campaign 2.0 ids start at 101.
  if (level.id > 100) return t('hud.level', { n: level.id - 100 });
  return t('hud.level', { n: level.id });
}

export function vehicleName(kind: VehicleKind): string {
  return t(`vehicle.${kind}` as Key);
}

export function starLabel(c: StarCheck): string {
  switch (c.id) {
    case 'complete':
      return t('star.complete');
    case 'par':
      return t('star.par', { v: c.value });
    case 'avgWait':
      return t('star.avgWait', { v: c.value.toFixed(1) });
    case 'maxWait':
      return t('star.maxWait', { v: c.value });
    case 'score':
      return t('star.score', { v: c.value });
  }
}

/** Russian plural form for a count: 1 машина, 2 машины, 5 машин. */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

/** "CARS" in the current language, agreeing with `n`. */
export function carsWord(n: number): string {
  if (current === 'ru') return pluralRu(n, ['МАШИНУ', 'МАШИНЫ', 'МАШИН']);
  return n === 1 ? 'CAR' : 'CARS';
}
