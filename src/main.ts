import Phaser from 'phaser';
import './style.css';
import { createGameConfig } from './config/gameConfig';
import { audio } from './systems/AudioManager';

const game = new Phaser.Game(createGameConfig('game'));

// Browsers only allow audio after a user gesture.
const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock, { passive: true });
window.addEventListener('touchstart', unlock, { passive: true });

// Expose for debugging / automated smoke tests.
(window as unknown as { __TRAFFIC_FLOW__: Phaser.Game }).__TRAFFIC_FLOW__ = game;
