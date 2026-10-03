/* ── oneui.js — One UI motion constants (vanilla twin of oneUI.ts) ──
   Single source of truth for motion on the site. The ×1.25 speed
   multiplier is global and hard: every animated control derives its
   timings from D, never from hardcoded numbers. A future change to
   the speed of the system happens HERE, nowhere else. */
const ONE_UI_EASING = 'cubic-bezier(0.22, 0.25, 0.00, 1.00)';

const SPEED_MULTIPLIER = 1.25;

const D = {
  short: 100 * SPEED_MULTIPLIER,  // 125ms
  base:  300 * SPEED_MULTIPLIER,  // 375ms
  long:  500 * SPEED_MULTIPLIER,  // 625ms
};
