# Structured Cabling — Project Archive

A gallery site for your networking install photos, grouped by phase, hosted on
GitHub Pages. The interface follows the Samsung Gallery app (One UI, dark):
a **Pictures** tab with every photo on a day-grouped wall, an **Albums** tab
with one cover per phase, a bottom tab bar, and a fullscreen swipe
viewer. Desktop defaults to a landscape layout (wide column, denser
wall); phones and tablets follow the device orientation — portrait
keeps the phone-width column, landscape widens to match.

Public visitors (your bosses) just browse. Signing in with an admin token lets
you add or remove photos straight from the browser — no backend, no database,
just this repo.

## The walkthrough

`/walkthrough/` is a guided, seven-step tour of the build — site survey to
final reveal — with real URLs (`/walkthrough/cabling/` etc., one static page
per step, so deep links are shareable). Visitors reach it from the ⋮ menu →
**Project walkthrough**. Step content lives in `walkthrough/steps.js` (slug,
title, one-sentence copy, hero + gallery photos pointing at the existing
`images/` assets); the runtime (`walkthrough/walkthrough.js`) renders each
page from that array, so adding a step means adding one object plus one static
folder — the progress ramp and navigation recompute themselves.

Slides move the way PowerPoint's transition gallery does. Each step declares
the transition that *arrives* at it (`transition` in `steps.js`), matched to
what the step is about — `wipe-up` for the plan sheet unrolling, `push-left`
for routes laid forward, `wipe-down` for bundles pulled down, `zoom-in` for
arrival on one panel, `fade` for the verification beat, `zoom-out` to pull
back for the whole build, and `morph` for the same rack in a new shot. Because
every step is its own document, the transition is split either side of the
page load: the outgoing page records the destination's kind in `sessionStorage`
and plays the mirror of it, the incoming page reads it back and plays the
arrival, so the move reads as one continuous transition rather than a cut.
Stepping backwards through the dots mirrors a push, like a deck does. Every
kind moves only `transform`, `opacity` and `clip-path` over the same three
D-derived durations and the one easing; reduced motion drops all of it and the
step is simply there.

## The guided tour

`/tour/` is a different kind of guide: an **action-gated** tour of the real
interface. Each step highlights a real control and the next step does not
exist until you do the real thing — there is no Continue button. Clicking
anywhere else, pressing Enter, or editing the URL does nothing; browser back
exits the tour. Escape opens two muted hatches (skip this step / end tour),
so the tour can never trap you. Steps are defined in `tour/steps.js`
(targets are `data-tour-target` attributes on the real controls), the state
machine and highlight engine live in `tour/tour.js`, and `tour/boot.js`
starts it when the gallery is opened with `?tour=1`. Progress persists in
`localStorage` (`walkthrough.tourState`): reloading resumes mid-tour, and a
completed tour never restarts on its own.

The tour has two audiences. Everyone walks the shared path: the photo wall,
the viewer's arrows, the Albums tab, an album, and the ⋮ menu — including
where admins sign in (11 steps). A user who is already signed in as admin when
the tour starts walks **every admin control** instead (54 steps): add photos
from the menu and from the + button, the upload dialog, search (type, scope,
clear), new album, select → mark → move → delete, album settings (rename,
remove, undo, revert), the per-album ⋮ menu, the viewer's download, classify
(save and cancel), viewer delete, and sign out. Sign in *before* starting the
tour to see that walk. Admin steps are filtered out for visitors — the tour
never renders a step the signed-out user cannot perform.

Every button the tour clicks is either guarded by the app (it changes nothing:
an empty-field toast, a `confirm()` the user cancels, or a real no-op) or is
one of two buttons marked `commit: true` — **Upload** and **Undo last change**,
which write to the repo with no guard and no confirmation. Those two are still
shown, but their hint says what the click really does and the way past is the
existing *Skip this step* escape. Nothing forces them.

Run the tour's test suite with `node --test tour/` (Node 18+; same
`node:test` + `vm`-sandbox harness as `tests/`). It covers gating, action
detection (including synthetic-event rejection), the confirm/unlock
hand-off, escapes, persistence, reduced-motion, a11y, the speed multiplier,
the audience filter, and the full 56-step authored tour end to end — plus a
coverage audit that fails if any button in `index.html` loses its tour step.

## Testing it before you have a repo

Open `index.html` with `owner`/`repo` still blank in `app.js` and the site
runs on local sample data — a "demo data" badge appears in the header. Every
feature works against this sample data: browsing phases, the lightbox,
signing in as admin (any text in the token box works in demo mode), adding
photos, deleting photos. Nothing touches GitHub while `owner`/`repo` are
blank, and none of it persists across a page reload. Once you fill in
`owner`/`repo` and reload, it switches to your real repo automatically and
the badge disappears.

One tip regardless of mode: open the file through a local server rather than
double-clicking it (VS Code's "Live Server" extension, or `npx serve` /
`python3 -m http.server` from this folder, then visit the printed
`localhost` URL). Some browsers restrict what a page opened directly via
`file://` can do, and a local server matches how GitHub Pages will actually
serve it.

## 1. Set up the repo

1. Create a new **public** GitHub repository (Pages on the free tier needs a
   public repo, unless you're on GitHub Enterprise/Pro).
2. Add these three files to the repo root: `index.html`, `style.css`, `app.js`.
3. Create an `images/` folder in the repo, with one subfolder per project
   phase, e.g.:

   ```
   images/
     site-survey/
       IMG_0001.jpg
       IMG_0002.jpg
     cable-pull/
       ...
     termination-testing/
       ...
     rack-build/
       ...
     handover/
       ...
   ```

   Folder names become the section headings in the gallery (as typed — use
   readable names like `cable-pull`, they'll render as-is). Any image dropped
   directly in `images/` with no subfolder is grouped under "General". This
   is exactly how you'll bulk-upload your 300+ existing photos: sort them
   into these folders locally, then drag the whole `images/` folder into the
   GitHub web UI or push it with git.

4. Open `app.js` and edit the four lines at the top:

   ```js
   const CONFIG = {
     owner: 'YOUR-GITHUB-USERNAME',
     repo: 'YOUR-REPO-NAME',
     branch: 'main',
     imagesPath: 'images',
   };
   ```

## 2. Turn on GitHub Pages

Repo → **Settings → Pages** → under "Build and deployment", set Source to
**Deploy from a branch**, pick `main` and `/ (root)`, save. Your site goes
live at `https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPO-NAME/` within a
minute or two. That's the link you hand to your bosses.

## 3. Create an admin token (for adding/deleting photos)

The site itself has no server, so "admin" works by talking to GitHub's own
API directly from your browser, using a personal access token you generate
and paste in yourself each session.

1. GitHub → your avatar → **Settings → Developer settings → Personal access
   tokens → Fine-grained tokens → Generate new token**.
2. Under "Repository access," choose **Only select repositories** and pick
   just this one repo. Don't use "All repositories."
3. Under "Permissions → Repository permissions," set **Contents: Read and
   write**. Leave everything else at no access.
4. Set an expiration (90 days is reasonable — you can generate a new one any
   time).
5. Generate, copy the token (starts with `github_pat_...`).

On the site, click **Admin** in the header and paste the token in. It's
checked once against the repo and then kept only in that browser tab's
session storage — it's cleared when you close the tab, and it's never
written into the repo or sent anywhere except `api.github.com`.

**Treat the token like a password.** Anyone who has it can add or delete
files in this one repo (that's all it can touch, since it's scoped to just
this repo). Don't paste it into the site on a shared or public computer, and
click "Sign out" when you're done to clear it early.

## 4. Using it day to day

- **Browsing:** open the link and scroll the day wall on **Pictures**, or tap
  **Albums** for one cover per phase. Tap any photo for the fullscreen
  viewer — swipe (or arrow keys) to move between photos, tap the photo to
  hide the bars, back-arrow or swipe-down to close.
- **Signing in:** tap **⋮** (top right) → **Admin sign in**.
- **Adding photos:** while signed in, tap the blue **+** button, or an album
  cover's **⋮ → Add photos**. **⋮ → New album…** starts a brand-new phase.
  Multi-select works.
- **Sorting photos:** long-press a photo (or **⋮ → Select photos**), tap the
  ones you want, then **Move** in the top bar. **Delete** sits beside it.
- **Removing one photo:** open it in the viewer and tap **Delete** (admin).
- Uploads/deletes are real commits to the repo (you'll see them in the repo's
  commit history), so there's a natural audit trail of who changed what and
  when, standard git history.

## Notes

- Images load from `raw.githubusercontent.com`. Browsers cache that
  aggressively, so after uploading, a hard refresh (Ctrl/Cmd+Shift+R) shows
  new photos immediately if they don't appear right away.
- This scales comfortably to a few hundred photos. If you eventually want
  faster loads for very large batches, the next step up would be generating
  thumbnails at upload time — not included here to keep this simple.
- No frameworks, no build step — just the three files. Fork away.
- Tests: `node --test tests/` (gallery logic) and `node --test tour/`
  (guided tour).