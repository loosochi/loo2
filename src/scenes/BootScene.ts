import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { generateTextures } from '../render/textures';
import { detectLang, setLang } from '../i18n';
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
    setLang(lm.save.lang ?? detectLang());
    document.documentElement.lang = lm.save.lang ?? detectLang();
    this.scene.start('Menu');
  }
}
