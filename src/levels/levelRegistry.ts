import type { LevelDef } from '../types';
import { level00 } from './level00';
import { level01 } from './level01';
import { level02 } from './level02';
import { level03 } from './level03';
import { level04 } from './level04';
import { level05 } from './level05';
import { level06 } from './level06';
import { level07 } from './level07';
import { level08 } from './level08';
import { level09 } from './level09';
import { CAMPAIGN_LEVELS } from './campaign/levels';

/** Campaign order. Level 0 is the tutorial. */
export const LEVELS: readonly LevelDef[] = [level00, level01, level02, level03, level04, level05, level06, level07, level08, level09];

/** Id of the last classic level. */
export const LAST_LEVEL_ID = LEVELS[LEVELS.length - 1].id;

/** Campaign 2.0 (road building): ids 101…110. */
export const CAMPAIGN2: readonly LevelDef[] = CAMPAIGN_LEVELS;
export const FIRST_CAMPAIGN_ID = CAMPAIGN2[0].id;
export const LAST_CAMPAIGN_ID = CAMPAIGN2[CAMPAIGN2.length - 1].id;

export const isCampaignId = (id: number): boolean => id >= FIRST_CAMPAIGN_ID;

export function getLevel(id: number): LevelDef | undefined {
  return (isCampaignId(id) ? CAMPAIGN2 : LEVELS).find((l) => l.id === id);
}
