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

   The tour has three segments, and boot.js picks the audience's
   segment before the engine ever sees the list (selectTourSteps):

     1. The shared path (everyone): the wall, the viewer's arrows,
        the Albums tab, an album, an album photo, the ⋮ menu.
     2. visitorOnly: where admins sign in — the sign-in box is a
        public surface (anyone may open it), so visitors see it and
        close it. The tour then completes.
     3. adminOnly: the admin tool set. These steps exist in this
        file but are filtered out for visitors — the tour never
        renders a step the signed-out user cannot perform. An admin
        who starts the tour signed in walks them all, each as the
        real action: add photos, the upload dialog, search (type,
        scope, clear), new album, select + move, album settings,
        classify, delete (the confirmation is canceled — the tour
        deletes nothing), and sign out.

   Steps that open a native dialog (the file picker behind Add
   photos, the delete confirmation) advance on the click that opens
   it; the dialog itself is the user's own business. Steps whose
   target only exists conditionally (the upload dialog appears only
   if a photo was picked) are skipped by the engine's missing-target
   rule if it never appears — skipped, never trapped.
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
 * @property {boolean}  [adminOnly]  boot.js drops this step unless the
 *                                   tour starts with admin signed in
 * @property {boolean}  [visitorOnly] boot.js drops this step when the
 *                                   tour starts with admin signed in
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

/* The authored tour. The `order` fields are the authored sequence;
   boot.js renumbers the audience-filtered list before the engine
   walks it, so the on-screen "N / total" is always right for both
   audiences (11 steps for visitors, 34 for signed-in admins). */
const TOUR_STEPS = [
  /* ── Segment 1: the shared path (every visitor) ─────────── */

  {
    id: 'wall-photo',
    order: 1,
    title: 'Open a photo from the wall',
    prompt: 'Click any photo on the Pictures wall.',
    hint: 'It opens fullscreen — arrows, swipes, and keys all work.',
    target: { kind: 'selector', selector: '[data-tour-target="photo-card"]', label: 'photo' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Viewer open.',
  },
  {
    id: 'viewer-next',
    order: 2,
    title: 'Browse to the next photo',
    prompt: 'Click the Next arrow.',
    hint: 'Arrow keys work too — the tour counts the button.',
    target: { kind: 'selector', selector: '[data-tour-target="viewer-next"]', label: 'Next photo arrow' },
    action: { kind: 'click' },
    confirm: { kind: 'checkmark' },
    unlockMessage: 'Next works.',
  },
  {
    id: 'viewer-prev',
    order: 3,
    title: 'Go back one photo',
    prompt: 'Click the Previous arrow.',
    hint: 'Previous wraps around to the end of the album.',
    target: { kind: 'selector', selector: '[data-tour-target="viewer-prev"]', label: 'Previous photo arrow' },
    action: { kind: 'click' },
    confirm: { kind: 'checkmark' },
    unlockMessage: 'Previous works.',
  },
  {
    id: 'viewer-close',
    order: 4,
    title: 'Close the photo viewer',
    prompt: 'Click the Back arrow.',
    hint: 'The wall is exactly where you left it.',
    target: { kind: 'selector', selector: '[data-tour-target="viewer-close"]', label: 'Back arrow' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Viewer closed.',
  },
  {
    id: 'albums-tab',
    order: 5,
    title: 'Open the Albums tab',
    prompt: 'Click the Albums tab.',
    hint: 'Every phase of the build lives here as its own album.',
    target: { kind: 'selector', selector: '[data-tour-target="tab-albums"]', label: 'Albums tab' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Albums unlocked.',
  },
  {
    id: 'album-open',
    order: 6,
    title: 'Open an album',
    prompt: 'Click an album cover.',
    hint: "The album's photos open in an inline grid.",
    target: { kind: 'selector', selector: '[data-tour-target="album-cover"]', label: 'album cover' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Album open.',
  },
  {
    id: 'album-photo',
    order: 7,
    title: 'Open a photo from the album',
    prompt: 'Click any photo in the grid.',
    hint: 'The viewer walks this album only.',
    target: { kind: 'selector', selector: '#albumDetailView [data-tour-target="photo-card"]', label: 'photo' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Viewer open.',
  },
  {
    id: 'album-viewer-close',
    order: 8,
    title: 'Close the viewer again',
    prompt: 'Click the Back arrow.',
    hint: 'You are still inside the album.',
    target: { kind: 'selector', selector: '[data-tour-target="viewer-close"]', label: 'Back arrow' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Viewer closed.',
  },
  {
    id: 'menu-open',
    order: 9,
    title: 'Open the options menu',
    prompt: 'Click the More options button.',
    hint: 'Everything the gallery can do starts here.',
    target: { kind: 'selector', selector: '[data-tour-target="menu-btn"]', label: 'More options button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Menu open.',
  },

  /* ── Segment 2: visitor-only — where admins sign in ─────── */

  {
    id: 'menu-admin-signin',
    order: 10,
    visitorOnly: true,
    title: 'See where admins sign in',
    prompt: 'Click Admin sign in.',
    hint: 'The sign-in box takes a repo-scoped token.',
    target: { kind: 'selector', selector: '[data-tour-target="menu-admin-signin"]', label: 'Admin sign in item' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Sign-in box open.',
  },
  {
    id: 'admin-modal-cancel',
    order: 11,
    visitorOnly: true,
    title: 'Close the sign-in box',
    prompt: 'Click Cancel.',
    hint: 'That is the whole visitor tour — the archive is yours.',
    target: { kind: 'selector', selector: '[data-tour-target="admin-modal-cancel"]', label: 'Cancel button' },
    action: { kind: 'click' },
    confirm: { kind: 'toast', text: 'Tour complete — welcome to the archive.' },
  },

  /* ── Segment 3: admin-only — the tool set (shown only when
        the tour starts signed in; boot.js filters by adminMode) ─ */

  {
    id: 'menu-add-photos',
    order: 12,
    adminOnly: true,
    title: 'Add photos to the archive',
    prompt: 'Click Add photos.',
    hint: 'The big + button does the same thing. Pick at least one photo so the upload dialog opens.',
    target: { kind: 'selector', selector: '[data-tour-target="menu-add-photos"]', label: 'Add photos item' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Picker open.',
  },
  {
    id: 'upload-cancel',
    order: 13,
    adminOnly: true,
    title: 'Cancel the upload dialog',
    prompt: 'Click Cancel in the upload dialog.',
    hint: 'Nothing uploads — this only shows the phase pre-sorting.',
    target: { kind: 'selector', selector: '[data-tour-target="upload-cancel"]', label: 'Cancel button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Upload dialog closed.',
  },
  {
    id: 'pictures-tab',
    order: 14,
    adminOnly: true,
    title: 'Back to the Pictures wall',
    prompt: 'Click the Pictures tab.',
    hint: 'Tabs switch views without losing your place.',
    target: { kind: 'selector', selector: '[data-tour-target="tab-pictures"]', label: 'Pictures tab' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Wall restored.',
  },
  {
    id: 'search-type',
    order: 15,
    adminOnly: true,
    title: 'Search the archive',
    prompt: 'Type in the search box.',
    hint: 'The wall filters as you type — try a name you can see.',
    target: { kind: 'selector', selector: '[data-tour-target="admin-search"]', label: 'search box' },
    action: { kind: 'input' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Search works.',
  },
  {
    id: 'search-scope',
    order: 16,
    adminOnly: true,
    title: 'Choose what to search',
    prompt: 'Open the scope dropdown and pick one.',
    hint: 'Photos searches the wall; albums searches the covers.',
    target: { kind: 'selector', selector: '[data-tour-target="admin-search-filter"]', label: 'scope dropdown' },
    action: { kind: 'input' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Scope picked.',
  },
  {
    id: 'search-clear',
    order: 17,
    adminOnly: true,
    title: 'Clear the search',
    prompt: 'Delete the search text.',
    hint: 'An empty box shows everything again.',
    target: { kind: 'selector', selector: '[data-tour-target="admin-search"]', label: 'search box' },
    // valueMatches '' succeeds only on an EMPTY box — typing more
    // text does not count. The engine treats '' as a real value.
    action: { kind: 'input', valueMatches: '' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Search cleared.',
  },
  {
    id: 'menu-open-2',
    order: 18,
    adminOnly: true,
    title: 'Open the options menu',
    prompt: 'Click the More options button.',
    hint: 'The menu holds the admin tools.',
    target: { kind: 'selector', selector: '[data-tour-target="menu-btn"]', label: 'More options button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Menu open.',
  },
  {
    id: 'menu-new-album',
    order: 19,
    adminOnly: true,
    title: 'Start a new album',
    prompt: 'Click New album…',
    hint: 'Name it, then pick the photos to start it with.',
    target: { kind: 'selector', selector: '[data-tour-target="menu-new-album"]', label: 'New album item' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'New-album box open.',
  },
  {
    id: 'new-album-cancel',
    order: 20,
    adminOnly: true,
    title: 'Close the new-album box',
    prompt: 'Click Cancel.',
    hint: 'No album is created.',
    target: { kind: 'selector', selector: '[data-tour-target="new-album-cancel"]', label: 'Cancel button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'New-album box closed.',
  },
  {
    id: 'menu-open-3',
    order: 21,
    adminOnly: true,
    title: 'Open the options menu',
    prompt: 'Click the More options button.',
    hint: 'Selection mode marks many photos at once.',
    target: { kind: 'selector', selector: '[data-tour-target="menu-btn"]', label: 'More options button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Menu open.',
  },
  {
    id: 'menu-select-photos',
    order: 22,
    adminOnly: true,
    title: 'Select several photos',
    prompt: 'Click Select photos.',
    hint: 'A bar appears above the wall — tap photos to mark them.',
    target: { kind: 'selector', selector: '[data-tour-target="menu-select-photos"]', label: 'Select photos item' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Selection mode on.',
  },
  {
    id: 'pick-photo',
    order: 23,
    adminOnly: true,
    title: 'Mark a photo',
    prompt: 'Click a photo to mark it.',
    hint: 'Marked photos get a checkmark badge.',
    target: { kind: 'selector', selector: '[data-tour-target="photo-card"]', label: 'photo' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Photo marked.',
  },
  {
    id: 'select-move',
    order: 24,
    adminOnly: true,
    title: 'Move the marked photos',
    prompt: 'Click Move.',
    hint: 'The move dialog picks the destination album.',
    target: { kind: 'selector', selector: '[data-tour-target="select-move"]', label: 'Move button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Move dialog open.',
  },
  {
    id: 'move-cancel',
    order: 25,
    adminOnly: true,
    title: 'Cancel the move',
    prompt: 'Click Cancel in the move dialog.',
    hint: 'The photos stay where they are.',
    target: { kind: 'selector', selector: '[data-tour-target="move-cancel"]', label: 'Cancel button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Move canceled.',
  },
  {
    id: 'select-close',
    order: 26,
    adminOnly: true,
    title: 'Exit selection mode',
    prompt: 'Click the Close button in the bar.',
    hint: 'The wall returns to normal.',
    target: { kind: 'selector', selector: '[data-tour-target="select-close"]', label: 'Close button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Selection mode off.',
  },
  {
    id: 'menu-open-4',
    order: 27,
    adminOnly: true,
    title: 'Open the options menu',
    prompt: 'Click the More options button.',
    hint: 'Album settings rename or remove a whole album.',
    target: { kind: 'selector', selector: '[data-tour-target="menu-btn"]', label: 'More options button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Menu open.',
  },
  {
    id: 'menu-album-settings',
    order: 28,
    adminOnly: true,
    title: 'Open album settings',
    prompt: 'Click Album settings.',
    hint: 'Pick an album, rename it, or remove it — removal has undo.',
    target: { kind: 'selector', selector: '[data-tour-target="menu-album-settings"]', label: 'Album settings item' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Album settings open.',
  },
  {
    id: 'album-settings-cancel',
    order: 29,
    adminOnly: true,
    title: 'Close album settings',
    prompt: 'Click Cancel.',
    hint: 'Nothing changes.',
    target: { kind: 'selector', selector: '[data-tour-target="album-settings-cancel"]', label: 'Cancel button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Album settings closed.',
  },
  {
    id: 'wall-photo-2',
    order: 30,
    adminOnly: true,
    title: 'Open a photo again',
    prompt: 'Click any photo on the wall.',
    hint: 'The viewer has two more admin tools.',
    target: { kind: 'selector', selector: '[data-tour-target="photo-card"]', label: 'photo' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Viewer open.',
  },
  {
    id: 'viewer-classify',
    order: 31,
    adminOnly: true,
    title: 'Classify the photo',
    prompt: 'Click Classify.',
    hint: 'Classify sets the journey stage and activity.',
    target: { kind: 'selector', selector: '[data-tour-target="viewer-classify"]', label: 'Classify button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Classify box open.',
  },
  {
    id: 'classify-cancel',
    order: 32,
    adminOnly: true,
    title: 'Close the classify box',
    prompt: 'Click Cancel.',
    hint: 'The photo keeps its current stage.',
    target: { kind: 'selector', selector: '[data-tour-target="classify-cancel"]', label: 'Cancel button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Classify box closed.',
  },
  {
    id: 'viewer-delete',
    order: 33,
    adminOnly: true,
    title: 'Delete a photo',
    prompt: 'Click Delete.',
    hint: 'Cancel the confirmation — this tour deletes nothing.',
    target: { kind: 'selector', selector: '[data-tour-target="viewer-delete"]', label: 'Delete button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Delete tool revealed.',
  },
  {
    id: 'viewer-close-2',
    order: 34,
    adminOnly: true,
    title: 'Close the viewer',
    prompt: 'Click the Back arrow.',
    hint: 'One tool left.',
    target: { kind: 'selector', selector: '[data-tour-target="viewer-close"]', label: 'Back arrow' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Viewer closed.',
  },
  {
    id: 'menu-open-5',
    order: 35,
    adminOnly: true,
    title: 'Open the options menu',
    prompt: 'Click the More options button.',
    hint: 'Signing out is the last stop.',
    target: { kind: 'selector', selector: '[data-tour-target="menu-btn"]', label: 'More options button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Menu open.',
  },
  {
    id: 'menu-sign-out',
    order: 36,
    adminOnly: true,
    title: 'Sign out of admin mode',
    prompt: 'Click Sign out.',
    hint: 'The admin tools fold away — the tour is complete.',
    target: { kind: 'selector', selector: '[data-tour-target="menu-sign-out"]', label: 'Sign out item' },
    action: { kind: 'click' },
    confirm: { kind: 'toast', text: 'Tour complete — the whole archive is yours.' },
  },
];
