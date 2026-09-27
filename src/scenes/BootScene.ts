import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { generateTextures } from '../render/textures';
import { audio } from '../systems/AudioManager';
import { levelManager } from '../systems/LevelManager';
import { makeText } from '../ui/uiKit';

/** Generates procedural textures, loads the player profile and moves on to the menu. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const { width, height } = this.scale;
    makeText(this, width / 2, height / 2, 'TRAFFIC FLOW', { size: 22, bold: true, color: COLORS.textDim }).setOrigin(0.5);
    generateTextures(this);
    const lm = levelManager();
    audio.setEnabled(lm.save.soundEnabled);
    this.scene.start('Menu');
  }
}
