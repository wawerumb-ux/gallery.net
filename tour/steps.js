/* ────────────────────────────────────────────────────────────────────
   tour/steps.js — the guided-tour step schema and the authored tour.

   The tour is a SEPARATE experience from the passive walkthrough
   (the request journey in /walkthrough/, which this file
   deliberately does not touch). Every step is action-gated: the next
   step does not exist
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
     3. adminOnly: every admin control, each as the real action —
        add photos and the upload dialog, search (type, scope,
        clear), new album, select + mark + move + delete, album
        settings (rename, remove, undo, revert), the per-album ⋮
        menu, the viewer's download, classify (save and cancel),
        viewer delete, and sign out.

   SAFETY — how each action is chosen:
     • Most commit buttons are guarded by the app itself, and the
       tour leans on that guard: Rename, Choose photos and Move
       photos all short-circuit with a toast when their field is
       empty; Remove album, the selection Delete and Revert all open
       a confirm() the user cancels; classify's Save is a true
       no-op (same-name rename guard + metadata hash guard). So the
       tour can click every one of them and change nothing.
     • Two buttons have NO guard and no confirm: Upload writes the
       picked files to the repo, and Undo last change restores it.
       They are still shown (a tour that hid them would not reveal
       all functionality) but are marked commit: true — the hint
       says what the click really does, and the intended way past is
       the existing "Skip this step" escape. Nothing forces it.
     • Steps whose target only exists conditionally (the upload
       dialog appears only if a photo was picked) are skipped by
       the engine's missing-target rule if it never appears —
       skipped, never trapped.
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
 * @property {boolean}  [commit]     the target writes to the repo with
 *                                   no guard and no confirm — the hint
 *                                   warns, and "Skip this step" is the
 *                                   intended way past
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
   audiences (11 steps for visitors, 54 for signed-in admins). */
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

  /* ── Segment 3: admin-only — every admin control (shown only
        when the tour starts signed in; boot.js filters by
        adminMode). Each action is the real one; the app's own
        guards keep every commit button a no-op (see the header). ─ */

  {
    id: 'menu-add-photos',
    order: 12,
    adminOnly: true,
    title: 'Add photos to the archive',
    prompt: 'Click Add photos.',
    hint: 'Pick at least one photo so the upload dialog opens.',
    target: { kind: 'selector', selector: '[data-tour-target="menu-add-photos"]', label: 'Add photos item' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Picker open.',
  },
  {
    id: 'upload-confirm',
    order: 13,
    adminOnly: true,
    commit: true,
    title: 'Upload the picked photos',
    prompt: 'Click Upload, or skip this step.',
    hint: 'Upload writes to the repo for real — skip it to tour on safely.',
    target: { kind: 'selector', selector: '[data-tour-target="upload-confirm"]', label: 'Upload button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Upload button seen.',
  },
  {
    id: 'upload-cancel',
    order: 14,
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
    id: 'fab-add',
    order: 15,
    adminOnly: true,
    title: 'Add photos from the + button',
    prompt: 'Click the + button.',
    hint: 'The same picker the menu opens — cancel it to move on.',
    target: { kind: 'selector', selector: '[data-tour-target="fab-add"]', label: 'Add photos + button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Picker open.',
  },
  {
    id: 'upload-cancel-2',
    order: 16,
    adminOnly: true,
    title: 'Cancel this upload too',
    prompt: 'Click Cancel in the upload dialog.',
    hint: 'Same dialog, same guard — nothing uploads.',
    target: { kind: 'selector', selector: '[data-tour-target="upload-cancel"]', label: 'Cancel button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Upload dialog closed.',
  },
  {
    id: 'pictures-tab',
    order: 17,
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
    order: 18,
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
    order: 19,
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
    order: 20,
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
    order: 21,
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
    order: 22,
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
    id: 'new-album-pick',
    order: 23,
    adminOnly: true,
    title: 'Choose photos for the album',
    prompt: 'Click Choose photos.',
    hint: 'With the name empty this shows the guard — no picker opens.',
    target: { kind: 'selector', selector: '[data-tour-target="new-album-pick"]', label: 'Choose photos button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Guard seen.',
  },
  {
    id: 'new-album-cancel',
    order: 24,
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
    order: 25,
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
    order: 26,
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
    order: 27,
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
    order: 28,
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
    id: 'move-confirm',
    order: 29,
    adminOnly: true,
    title: 'See the Move photos button',
    prompt: 'Click Move photos.',
    hint: 'With no album chosen this shows the guard — nothing moves.',
    target: { kind: 'selector', selector: '[data-tour-target="move-confirm"]', label: 'Move photos button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Guard seen.',
  },
  {
    id: 'move-cancel',
    order: 30,
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
    id: 'select-delete',
    order: 31,
    adminOnly: true,
    title: 'Delete the marked photos',
    prompt: 'Click Delete in the selection bar.',
    hint: 'Cancel the confirmation — this tour deletes nothing.',
    target: { kind: 'selector', selector: '[data-tour-target="select-delete"]', label: 'Delete button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Delete dialog seen.',
  },
  {
    id: 'select-close',
    order: 32,
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
    order: 33,
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
    order: 34,
    adminOnly: true,
    title: 'Open album settings',
    prompt: 'Click Album settings.',
    hint: 'Rename, remove, undo, or revert — everything here is a commit.',
    target: { kind: 'selector', selector: '[data-tour-target="menu-album-settings"]', label: 'Album settings item' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Album settings open.',
  },
  {
    id: 'settings-rename',
    order: 35,
    adminOnly: true,
    title: 'Rename an album',
    prompt: 'Click Rename.',
    hint: 'With the name empty this shows the guard — nothing is renamed.',
    target: { kind: 'selector', selector: '[data-tour-target="settings-rename"]', label: 'Rename button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Guard seen.',
  },
  {
    id: 'settings-remove',
    order: 36,
    adminOnly: true,
    title: 'Remove an album',
    prompt: 'Click Remove album.',
    hint: 'Cancel the confirmation — no photo is deleted.',
    target: { kind: 'selector', selector: '[data-tour-target="settings-remove"]', label: 'Remove album button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Remove dialog seen.',
  },
  {
    id: 'settings-undo',
    order: 37,
    adminOnly: true,
    commit: true,
    title: 'Step back the last change',
    prompt: 'Click Undo last change, or skip this step.',
    hint: 'This restores the real repo — skip it to tour on safely.',
    target: { kind: 'selector', selector: '[data-tour-target="settings-undo"]', label: 'Undo the last change button' },
    beforeShow() { const h = document.getElementById('historyPanel'); if (h) h.open = true; },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Undo button seen.',
  },
  {
    id: 'settings-revert',
    order: 38,
    adminOnly: true,
    title: 'Revert every change',
    prompt: 'Click Revert every change.',
    hint: 'Read the scope it spells out, then Cancel — every photo and album stays.',
    target: { kind: 'selector', selector: '[data-tour-target="settings-revert"]', label: 'Revert every change button' },
    beforeShow() { const h = document.getElementById('historyPanel'); if (h) h.open = true; },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Revert dialog seen.',
  },
  {
    id: 'album-settings-cancel',
    order: 39,
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
    id: 'albums-tab-2',
    order: 40,
    adminOnly: true,
    title: 'Back to the album covers',
    prompt: 'Click the Albums tab.',
    hint: 'Each cover carries its own ⋮ menu.',
    target: { kind: 'selector', selector: '[data-tour-target="tab-albums"]', label: 'Albums tab' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Albums unlocked.',
  },
  {
    id: 'album-menu-open',
    order: 41,
    adminOnly: true,
    title: "Open an album's own menu",
    prompt: 'Click the ⋮ on an album cover.',
    hint: 'It holds Add photos and Album settings for that one album.',
    target: { kind: 'selector', selector: '[data-tour-target="album-menu"]', label: 'album ⋮ button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Album menu open.',
  },
  {
    id: 'album-menu-add-photos',
    order: 42,
    adminOnly: true,
    title: 'Add photos to this album',
    prompt: 'Click Add photos.',
    hint: 'The same picker, scoped to this album — cancel it to move on.',
    target: { kind: 'selector', selector: '[data-tour-target="album-menu-add-photos"]', label: 'Add photos item' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Picker open.',
  },
  {
    id: 'album-menu-open-2',
    order: 43,
    adminOnly: true,
    title: "Open that album's menu again",
    prompt: 'Click the ⋮ on an album cover.',
    hint: 'The sheet closes on every tap, so it opens fresh.',
    target: { kind: 'selector', selector: '[data-tour-target="album-menu"]', label: 'album ⋮ button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Album menu open.',
  },
  {
    id: 'menu-album-settings-2',
    order: 44,
    adminOnly: true,
    title: "Open this album's settings",
    prompt: 'Click Album settings.',
    hint: 'This one is preselected to the album you tapped.',
    target: { kind: 'selector', selector: '[data-tour-target="album-menu-album-settings"]', label: 'Album settings item' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Album settings open.',
  },
  {
    id: 'album-settings-cancel-2',
    order: 45,
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
    id: 'pictures-tab-2',
    order: 46,
    adminOnly: true,
    title: 'Back to the Pictures wall',
    prompt: 'Click the Pictures tab.',
    hint: 'One more photo — the viewer still has tools.',
    target: { kind: 'selector', selector: '[data-tour-target="tab-pictures"]', label: 'Pictures tab' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Wall restored.',
  },
  {
    id: 'wall-photo-2',
    order: 47,
    adminOnly: true,
    title: 'Open a photo again',
    prompt: 'Click any photo on the wall.',
    hint: 'The viewer has the last three tools.',
    target: { kind: 'selector', selector: '[data-tour-target="photo-card"]', label: 'photo' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Viewer open.',
  },
  {
    id: 'viewer-download',
    order: 48,
    adminOnly: true,
    title: 'Download the photo',
    prompt: 'Click the download button.',
    hint: 'It fetches the full-resolution file for the photo on screen.',
    // The DownloadButton component is not modified; its <a> is
    // targeted by its real container selector instead.
    target: { kind: 'selector', selector: '#lightboxDownloadSlot a', label: 'download button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Download works.',
  },
  {
    id: 'viewer-classify',
    order: 49,
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
    id: 'classify-save',
    order: 50,
    adminOnly: true,
    title: 'Save the classification',
    prompt: 'Click Save.',
    hint: 'Nothing changed in the fields, so this saves without renaming.',
    target: { kind: 'selector', selector: '[data-tour-target="classify-save"]', label: 'Save button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Saved classification.',
  },
  {
    id: 'viewer-classify-2',
    order: 51,
    adminOnly: true,
    title: 'Open classify again',
    prompt: 'Click Classify.',
    hint: 'The same box — this time just close it.',
    target: { kind: 'selector', selector: '[data-tour-target="viewer-classify"]', label: 'Classify button' },
    action: { kind: 'click' },
    confirm: { kind: 'pulse' },
    unlockMessage: 'Classify box open.',
  },
  {
    id: 'classify-cancel',
    order: 52,
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
    order: 53,
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
    order: 54,
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
    order: 55,
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
    order: 56,
    adminOnly: true,
    title: 'Sign out of admin mode',
    prompt: 'Click Sign out.',
    hint: 'The admin tools fold away — the tour is complete.',
    target: { kind: 'selector', selector: '[data-tour-target="menu-sign-out"]', label: 'Sign out item' },
    action: { kind: 'click' },
    confirm: { kind: 'toast', text: 'Tour complete — the whole archive is yours.' },
  },
];