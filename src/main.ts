import Phaser from 'phaser';
import './style.css';
import { createGameConfig } from './config/gameConfig';
import { initPwa } from './pwa';
import { audio } from './systems/AudioManager';

initPwa();
const game = new Phaser.Game(createGameConfig('game'));

// Keep ctrl+wheel / trackpad pinch for map zoom instead of page zoom.
game.events.once(Phaser.Core.Events.READY, () => {
  game.canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
});

// Browsers only allow audio after a user gesture.
const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock, { passive: true });
window.addEventListener('touchstart', unlock, { passive: true });

// Expose for debugging / automated smoke tests.
(window as unknown as { __TRAFFIC_FLOW__: Phaser.Game }).__TRAFFIC_FLOW__ = game;
