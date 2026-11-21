import type { BriefingBullet } from '../contracts.js';

export const MASK = '•••••';

export function maskIf(privacy: boolean, value: string): string {
  return privacy ? MASK : value;
}

/** Bullets derived from calendar, Canvas or Garmin facts are masked in privacy mode. */
export function bulletText(bullet: BriefingBullet, privacy: boolean): string {
  if (!privacy) return bullet.text;
  return bullet.sources.some((s) => s === 'google' || s === 'canvas' || s === 'garmin') ? MASK : bullet.text;
}
