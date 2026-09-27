import type { LevelDef } from '../types';
import { level01 } from './level01';
import { level02 } from './level02';
import { level03 } from './level03';
import { level04 } from './level04';
import { level05 } from './level05';

export const LEVELS: readonly LevelDef[] = [level01, level02, level03, level04, level05];

export function getLevel(id: number): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}
