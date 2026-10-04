/* ────────────────────────────────────────────────────────────────────
   tour/steps.js — the guided-tour step schema and the authored tour.

   The tour is a SEPARATE experience from the passive walkthrough
   (walkthrough/steps.js, which this file deliberately does not
   touch). Every step is action-gated: the next step does not exist
   in the DOM until the current step's real action succeeds. There
   is no Continue button anywhere — the action is the only way
   forward, with muted escape hatches as the never-primary fallback.

   Targets use data-tour-target attributes on the REAL gallery
   interface (index.html / app.js), never mock elements.
   ──────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} TourStep
 * @property {string}   id           kebab-case, unique
 * @property {number}   order        1-based
 * @property {string}   title        3–6 words, sentence case
 * @property {string}   prompt       what the user must do, imperative
 * @property {string}   [hint]       optional second-line clarification
 * @property {TourTarget} target     what element to highlight
 * @property {TourAction} action     what counts as success
 * @property {TourConfirm} confirm   what plays on success
 * @property {TourEscape} [escape]   optional fallback if stuck
 * @property {string}   [unlockMessage] short line shown after confirm
 */

/**
 * @typedef {{ kind: 'selector', selector: string, label: string }
 *          | { kind: 'element', ref: string, label: string }
 *          | { kind: 'region', bounds: [number, number, number, number] }
 *          | { kind: 'canvas', objectName: string }} TourTarget */

/**
 * @typedef {{ kind: 'click' }
 *          | { kind: 'hover', durationMs: number }
 *          | { kind: 'input', valueMatches?: string }
 *          | { kind: 'scroll-to', selector: string }
 *          | { kind: 'select-filter', filter: string, value: string }
 *          | { kind: 'open-panel', panelId: string }
 *          | { kind: 'download-start' }
 *          | { kind: 'custom', eventName: string }} TourAction */

/**
 * @typedef {{ kind: 'pulse' }
 *          | { kind: 'checkmark' }
 *          | { kind: 'toast', text: string }
 *          | { kind: 'silent' }} TourConfirm */

/**
 * @typedef {{ kind: 'skip-action', label: string }
 *          | { kind: 'skip-tour', label: string }} TourEscape */

/* The authored tour: five steps, one per real gesture a visitor
   makes in the gallery. Every action is a click on a real control
   — the public path only. Admin-gated surfaces (search pill,
   classify, delete) are deliberately NOT tour steps: they sit
   behind the admin sign-in wall, and the tour must never render
   a step the visitor cannot perform. */
const TOUR_STEPS = [
  {
    id: 'open-albums',
    order: 1,
    title: 'Open the Albums tab',
    prompt: 'Click the Albums tab.',
    hint: 'Every phase of the build lives here as its own album.',
    target: { kind: 'selector', selector: '[data-tour-target="tab-albums"]', label: 'Albums tab' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    escape: { kind: 'skip-tour', label: 'End tour' },
    unlockMessage: 'Albums unlocked.',
  },
  {
    id: 'open-album',
    order: 2,
    title: 'Open the first album',
    prompt: 'Click an album cover.',
    hint: 'The album opens its photos in an inline grid.',
    target: { kind: 'selector', selector: '[data-tour-target="album-cover"]', label: 'album cover' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    escape: { kind: 'skip-tour', label: 'End tour' },
    unlockMessage: 'Album open.',
  },
  {
    id: 'open-photo',
    order: 3,
    title: 'Open a photo',
    prompt: 'Click any photo in the grid.',
    hint: 'It opens fullscreen — swipe or use the arrows.',
    target: { kind: 'selector', selector: '#albumDetailView [data-tour-target="photo-card"]', label: 'photo' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    escape: { kind: 'skip-tour', label: 'End tour' },
    unlockMessage: 'Viewer open.',
  },
  {
    id: 'next-photo',
    order: 4,
    title: 'Browse to the next photo',
    prompt: 'Click the Next arrow.',
    hint: 'Arrow keys work too — the tour counts the button.',
    target: { kind: 'selector', selector: '[data-tour-target="viewer-next"]', label: 'Next photo arrow' },
    action: { kind: 'click' },
    confirm: { kind: 'checkmark' },
    escape: { kind: 'skip-tour', label: 'End tour' },
    unlockMessage: 'Browsing works.',
  },
  {
    id: 'close-viewer',
    order: 5,
    title: 'Close the photo viewer',
    prompt: 'Click the Back arrow.',
    hint: 'That is the whole tour — the archive is yours.',
    target: { kind: 'selector', selector: '[data-tour-target="viewer-close"]', label: 'Back arrow' },
    action: { kind: 'click' },
    confirm: { kind: 'toast', text: 'Tour complete — welcome to the archive.' },
    escape: { kind: 'skip-tour', label: 'End tour' },
  },
];
