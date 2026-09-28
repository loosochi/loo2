/**
 * Progressive Web App glue: service worker registration (production builds only) and the
 * browser's "install app" prompt.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

export function initPwa(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((fn) => fn());
  });
  if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        /* not allowed here (e.g. inside a sandboxed frame) — the game still works online */
      });
    });
  }
}

export function canInstall(): boolean {
  return deferred !== null;
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  await e.prompt();
  const choice = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  listeners.forEach((fn) => fn());
  return choice.outcome === 'accepted';
}

/** True when the service worker controls the page (assets cached for offline play). */
export function isOfflineReady(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
}
