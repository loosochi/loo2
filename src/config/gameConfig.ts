import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { EditorScene } from '../scenes/EditorScene';
import { GameScene } from '../scenes/GameScene';
import { LevelSelectScene } from '../scenes/LevelSelectScene';
import { MenuScene } from '../scenes/MenuScene';
import { RecordsScene } from '../scenes/RecordsScene';
import { ResultScene } from '../scenes/ResultScene';
import { COLORS } from './theme';

export function createGameConfig(parent: string): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: COLORS.bg,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    render: {
      antialias: true,
      roundPixels: false,
      powerPreference: 'high-performance',
    },
    input: {
      activePointers: 3,
    },
    disableContextMenu: true,
    fps: { target: 60, smoothStep: true },
    scene: [BootScene, MenuScene, LevelSelectScene, GameScene, ResultScene, RecordsScene, EditorScene],
  };
}
