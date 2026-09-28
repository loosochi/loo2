import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { getLang, setLang, t } from '../i18n';
import { level06 } from '../levels/level06';
import { canInstall, isOfflineReady, onInstallChange, promptInstall } from '../pwa';
import { WorldRenderer } from '../render/WorldRenderer';
import { audio } from '../systems/AudioManager';
import { AutoPilot } from '../systems/AutoPilot';
import { levelManager } from '../systems/LevelManager';
import { TrafficSimulation } from '../systems/TrafficSimulation';
import { Button } from '../ui/Button';
import { openDialog } from '../ui/domDialog';
import { Modal } from '../ui/Modal';
import { createSplitView, drawStar, enterScene, goTo, makeText, uiScale, type SplitView } from '../ui/uiKit';
import { FrameClock } from '../utils/clock';

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
    this.clock.reset();
    this.view = createSplitView(this);
    this.startDemo();
    this.ui = this.add.container(0, 0);
    this.view.uiRoot.add(this.ui);
    this.buildUI();
    const onResize = () => {
      this.fitDemo();
      this.buildUI();
    };
    const offInstall = onInstallChange(() => this.buildUI());
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      offInstall();
      this.worldView.destroy();
    });
    enterScene(this);
  }

  private startDemo(): void {
    this.worldView?.destroy();
    this.sim = new TrafficSimulation(level06);
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
    dim.fillStyle(COLORS.bgDeep, 0.58);
    dim.fillRect(0, 0, W, H);
    this.ui.add(dim);

    const compact = H < 560;
    const titleY = compact ? Math.max(56 * s, H * 0.16) : H * 0.22;
    if (!compact) {
      const logo = this.add.graphics();
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
      this.ui.add(logo);
    }

    const title = makeText(this, W / 2, titleY, 'TRAFFIC FLOW', { size: Math.min(64 * s, W / 8), bold: true }).setOrigin(0.5);
    title.setShadow(0, 4, 'rgba(0,0,0,0.45)', 8);
    const sub = makeText(this, W / 2, titleY + 40 * s, t('menu.subtitle'), {
      size: 16 * s,
      color: 0xc9d2e8,
      align: 'center',
      wrap: W - 32,
    }).setOrigin(0.5);
    this.ui.add([title, sub]);
    this.tweens.add({ targets: title, scale: { from: 0.94, to: 1 }, duration: 600, ease: 'Back.Out' });

    const lm = levelManager();
    const target = lm.playTarget();
    const bw = Math.min(W - 40, 340 * s);
    const bh = Math.max(46, (compact ? 48 : 56) * s);
    const gap = 12 * s;
    let y = titleY + (compact ? 70 : 96) * s;
    const play = new Button(this, W / 2, y + bh / 2, {
      label: target === 0 ? t('menu.playTutorial') : t('menu.play', { n: target }),
      icon: 'play',
      width: bw,
      height: bh,
      style: 'primary',
      onClick: () => goTo(this, 'Game', { levelId: target }),
    });
    this.ui.add(play);
    y += bh + gap;

    // Two columns of secondary actions.
    const half = (bw - gap) / 2;
    const grid: { label: string; icon: 'grid' | 'trophy' | 'edit' | 'gear'; go: () => void }[] = [
      { label: t('menu.levels'), icon: 'grid', go: () => goTo(this, 'LevelSelect') },
      { label: t('menu.records'), icon: 'trophy', go: () => goTo(this, 'Records') },
      { label: t('menu.editor'), icon: 'edit', go: () => goTo(this, 'Editor') },
      { label: t('menu.settings'), icon: 'gear', go: () => this.openSettings() },
    ];
    grid.forEach((b, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = W / 2 - bw / 2 + half / 2 + col * (half + gap);
      const by = y + row * (bh + gap) + bh / 2;
      this.ui.add(new Button(this, x, by, { label: b.label, icon: b.icon, width: half, height: bh, style: 'secondary', fontSize: 15 * s, onClick: b.go }));
    });

    // Footer: stars, offline badge, install.
    const footY = H - 26 * s;
    const stars = this.add.graphics();
    const starsText = makeText(this, W / 2 + 10 * s, footY, `${lm.totalStars} / ${lm.starLevels.length * 5}`, {
      size: 15 * s,
      bold: true,
      color: COLORS.star,
    }).setOrigin(0, 0.5);
    drawStar(stars, W / 2 - 6 * s, footY, 10 * s, COLORS.star);
    this.ui.add([stars, starsText]);
    if (isOfflineReady()) {
      this.ui.add(makeText(this, 14 * s, footY, t('menu.offline'), { size: 12 * s, color: COLORS.good, bold: true }).setOrigin(0, 0.5));
    }
    if (canInstall()) {
      const ib = new Button(this, W - 14 * s - 80 * s, 14 * s + 22 * s, {
        label: t('menu.install'),
        icon: 'download',
        width: 160 * s,
        height: Math.max(40, 44 * s),
        style: 'secondary',
        fontSize: 13 * s,
        onClick: () => void promptInstall(),
      });
      this.ui.add(ib);
    }
  }

  private openSettings(): void {
    const lm = levelManager();
    this.modal?.destroy();
    const soundLabel = () => t('settings.sound', { state: lm.save.soundEnabled ? t('common.on') : t('common.off') });
    const nameLabel = () => t('settings.name', { name: lm.save.playerName || t('common.player') });
    const modal = new Modal(this, {
      title: t('settings.title'),
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
        {
          label: t('settings.language'),
          icon: 'globe',
          style: 'secondary',
          onClick: () => {
            const next = getLang() === 'en' ? 'ru' : 'en';
            lm.save.setLang(next);
            setLang(next);
            this.buildUI();
            this.openSettings();
          },
        },
        {
          label: nameLabel(),
          icon: 'user',
          style: 'secondary',
          onClick: () => {
            openDialog({
              title: t('settings.nameTitle'),
              value: lm.save.playerName,
              placeholder: t('common.player'),
              maxLength: 16,
              buttons: [
                { label: t('common.cancel'), action: () => undefined },
                {
                  label: 'OK',
                  primary: true,
                  action: (v) => {
                    lm.save.setPlayerName(v);
                    modal.buttons[2]?.setLabel(nameLabel());
                  },
                },
              ],
            });
          },
        },
        { label: t('settings.reset'), icon: 'restart', style: 'danger', onClick: () => this.confirmReset() },
        { label: t('common.close'), icon: 'back', style: 'primary', onClick: () => this.closeModal() },
      ],
    });
    this.modal = modal;
    this.ui.add(modal);
  }

  private confirmReset(): void {
    this.closeModal();
    const modal = new Modal(this, {
      title: t('reset.title'),
      subtitle: t('reset.body'),
      buttons: [
        {
          label: t('reset.confirm'),
          style: 'danger',
          onClick: () => {
            const lm = levelManager();
            lm.save.reset();
            lm.records.clear();
            this.buildUI();
          },
        },
        { label: t('common.cancel'), style: 'secondary', onClick: () => this.closeModal() },
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
    const steps = this.sim.advance(delta / 1000);
    for (let i = 0; i < steps; i++) this.pilot.update(1 / 60);
    if (this.sim.status !== 'running') this.startDemo();
    this.worldView.update(delta);
  }
}
