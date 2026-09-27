import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { level03 } from '../levels/level03';
import { WorldRenderer } from '../render/WorldRenderer';
import { audio } from '../systems/AudioManager';
import { AutoPilot } from '../systems/AutoPilot';
import { levelManager } from '../systems/LevelManager';
import { TrafficSimulation } from '../systems/TrafficSimulation';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { FrameClock } from '../utils/clock';
import { createSplitView, drawStar, enterScene, goTo, makeText, uiScale, type SplitView } from '../ui/uiKit';

/** Title screen with a live, self-driving traffic demo in the background. */
export class MenuScene extends Phaser.Scene {
  private view!: SplitView;
  private sim!: TrafficSimulation;
  private pilot!: AutoPilot;
  private worldView!: WorldRenderer;
  private ui!: Phaser.GameObjects.Container;
  private modal: Modal | null = null;
  private readonly clock = new FrameClock();

  constructor() {
    super('Menu');
  }

  create(): void {
    this.modal = null;
    this.view = createSplitView(this);
    this.startDemo();
    this.ui = this.add.container(0, 0);
    this.view.uiRoot.add(this.ui);
    this.buildUI();
    const onResize = () => {
      this.fitDemo();
      this.buildUI();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      this.worldView.destroy();
    });
    enterScene(this);
  }

  private startDemo(): void {
    this.worldView?.destroy();
    this.sim = new TrafficSimulation(level03);
    this.pilot = new AutoPilot(this.sim);
    this.worldView = new WorldRenderer(this, this.sim, this.view.worldLayer);
    this.worldView.showDanger = false;
    this.fitDemo();
  }

  private fitDemo(): void {
    const { width, height } = this.scale;
    const cam = this.view.worldCam;
    cam.setSize(width, height);
    this.view.uiCam.setSize(width, height);
    const w = this.sim.level.world;
    cam.setZoom(Math.max(width / w.width, height / w.height) * 1.05);
    cam.centerOn(w.width / 2, w.height / 2);
  }

  private buildUI(): void {
    this.ui.removeAll(true);
    this.modal = null;
    const { width: W, height: H } = this.scale;
    const s = uiScale(this);
    const dim = this.add.graphics();
    dim.fillStyle(COLORS.bgDeep, 0.55);
    dim.fillRect(0, 0, W, H);
    this.ui.add(dim);

    const compact = H < 520;
    const titleY = compact ? H * 0.2 : H * 0.28;
    const logo = this.add.graphics();
    // Small traffic light emblem.
    const lx = W / 2;
    const ly = titleY - 78 * s;
    logo.fillStyle(0x000000, 0.3);
    logo.fillRoundedRect(lx - 36 * s + 3, ly - 14 * s + 4, 72 * s, 28 * s, 14 * s);
    logo.fillStyle(COLORS.lightHousing, 1);
    logo.fillRoundedRect(lx - 36 * s, ly - 14 * s, 72 * s, 28 * s, 14 * s);
    [COLORS.lightRed, COLORS.lightYellow, COLORS.lightGreen].forEach((c, i) => {
      logo.fillStyle(c, 1);
      logo.fillCircle(lx + (i - 1) * 22 * s, ly, 8 * s);
    });
    if (compact) logo.setVisible(false);
    this.ui.add(logo);

    const title = makeText(this, W / 2, titleY, 'TRAFFIC FLOW', { size: Math.min(64 * s, W / 8), bold: true }).setOrigin(0.5);
    title.setShadow(0, 4, 'rgba(0,0,0,0.45)', 8);
    const sub = makeText(this, W / 2, titleY + 42 * s, 'Keep the city moving. Avoid the crash.', {
      size: 16 * s,
      color: 0xc9d2e8,
    }).setOrigin(0.5);
    this.ui.add([title, sub]);
    this.tweens.add({ targets: title, scale: { from: 0.94, to: 1 }, duration: 600, ease: 'Back.Out' });

    const lm = levelManager();
    const target = lm.playTarget();
    const bw = Math.min(W - 48, 300 * s);
    const bh = Math.max(48, 58 * s);
    const gap = 14 * s;
    let y = titleY + (compact ? 80 : 110) * s;
    const play = new Button(this, W / 2, y + bh / 2, {
      label: `PLAY  ·  LEVEL ${target}`,
      icon: 'play',
      width: bw,
      height: bh,
      style: 'primary',
      onClick: () => goTo(this, 'Game', { levelId: target }),
    });
    y += bh + gap;
    const levels = new Button(this, W / 2, y + bh / 2, {
      label: 'LEVELS',
      icon: 'grid',
      width: bw,
      height: bh,
      style: 'secondary',
      onClick: () => goTo(this, 'LevelSelect'),
    });
    y += bh + gap;
    const settings = new Button(this, W / 2, y + bh / 2, {
      label: 'SETTINGS',
      icon: 'gear',
      width: bw,
      height: bh,
      style: 'secondary',
      onClick: () => this.openSettings(),
    });
    this.ui.add([play, levels, settings]);

    const stars = this.add.graphics();
    const starsText = makeText(this, W / 2 + 10 * s, H - 26 * s, `${lm.totalStars} / ${lm.levels.length * 5}`, {
      size: 15 * s,
      bold: true,
      color: COLORS.star,
    }).setOrigin(0, 0.5);
    drawStar(stars, W / 2 - 6 * s, H - 26 * s, 10 * s, COLORS.star);
    this.ui.add([stars, starsText]);
  }

  private openSettings(): void {
    const lm = levelManager();
    this.modal?.destroy();
    const soundLabel = () => `SOUND: ${lm.save.soundEnabled ? 'ON' : 'OFF'}`;
    const modal = new Modal(this, {
      title: 'SETTINGS',
      buttons: [
        {
          label: soundLabel(),
          icon: lm.save.soundEnabled ? 'sound' : 'mute',
          style: 'secondary',
          onClick: () => {
            const on = !lm.save.soundEnabled;
            lm.save.setSound(on);
            audio.setEnabled(on);
            audio.unlock();
            audio.play('click');
            modal.buttons[0].setLabel(soundLabel()).setIcon(on ? 'sound' : 'mute');
          },
        },
        { label: 'RESET PROGRESS', icon: 'restart', style: 'danger', onClick: () => this.confirmReset() },
        { label: 'CLOSE', icon: 'back', style: 'primary', onClick: () => this.closeModal() },
      ],
    });
    this.modal = modal;
    this.ui.add(modal);
  }

  private confirmReset(): void {
    this.closeModal();
    const modal = new Modal(this, {
      title: 'RESET PROGRESS?',
      subtitle: 'Stars, scores and unlocked levels will be lost.',
      buttons: [
        {
          label: 'YES, RESET',
          style: 'danger',
          onClick: () => {
            levelManager().save.reset();
            this.buildUI();
          },
        },
        { label: 'CANCEL', style: 'secondary', onClick: () => this.closeModal() },
      ],
    });
    this.modal = modal;
    this.ui.add(modal);
  }

  private closeModal(): void {
    this.modal?.destroy();
    this.modal = null;
  }

  override update(): void {
    const delta = this.clock.tick();
    const dt = delta / 1000;
    const steps = this.sim.advance(dt);
    for (let i = 0; i < steps; i++) this.pilot.update(1 / 60);
    if (this.sim.status !== 'running') this.startDemo();
    this.worldView.update(delta);
  }
}
