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

`/walkthrough/` is the site's front door: the gallery sends a first-time
visitor there and the page's only job is to tell them what this is and
offer the way in. There is no menu entry for it — the ⋮ menu goes
straight to the guided tour. Come back by URL.

Nothing in the UI calls it a walkthrough any more — the page is just the
page you start on. The name survives only in code: the folder, the
`walkthrough.seen` / `walkthrough.tourState` keys, `shouldRequireWalkthrough()`
and the `walkthrough:journey-end` event.

## Typeface

The app bar's `ff` toggle offers twelve faces. **One UI Sans** is the one
that matters for a Samsung device: the S10 runs One UI on SamsungOne,
which cannot be shipped on a website because it is a system font
licensed to the handset — but `system-ui` *resolves* to it on a Galaxy,
and to Segoe or San Francisco everywhere else, at no download. On a
desktop that option looks like your OS font, not the S10's; that is the
honest ceiling.

**Roboto** stays the default so an untouched archive is byte-identical.
The remaining ten are the closest free stand-ins for a humanist-geometric
UI voice, plus a script, two blackletters and a serif for anyone reading
captions rather than scanning.

The style names under each swatch — *bold, italic, bold italic, cursive,
monospace, small caps, gothic/fraktur, old English, double-struck,
circled* — are sourced from [LingoJam](https://lingojam.org)'s text-style
generator. **The faces behind those names are not.** LingoJam publishes no
font files at all: its "fonts" are Unicode symbol mappings from the
Mathematical Alphanumeric Symbols blocks, which render as styled text
only where the device covers those ranges and as tofu squares where it
does not. Each name here is therefore backed by a real, properly
licensed face from Google Fonts, which is where this archive already
gets Roboto and IBM Plex Mono.

Nothing loads up front. Every face is appended the moment it is first
wanted — opening the picker asks for the whole set in one request at
regular weight so the previews are legible, and choosing one then loads
that face's real weight range on its own. The two blackletter faces ship
a single weight and are labelled *display*: the bold on those is the
browser synthesising it. `--font-sans` is the only token the picker
touches — filenames, counts and load bars stay in the mono stack, where
they read as code in any face.

The choice is stored under `gallery.font` and read back into
`<html data-font>`.

### The popover

The picker is a **popover**, not a bottom sheet, and both of its
references say so explicitly.

[Balsamiq's pop-up/modal/lightbox guidelines](https://balsamiq.com/learn/popups-modals-lightboxes/)
classify the three: a *pop-up* is marketing material that appears on page
load and interrupts the journey ("use them very sparingly"); a *modal* is
one **the user initiated as part of their journey**, for a specific task;
a *lightbox* is what opens when a user **clicks to enlarge an image**. The
typeface picker is modal-class — the visitor tapped `ff` to get it, and it
is a task. The fullscreen viewer is lightbox-class, and the walkthrough's
first-visit redirect is the only thing here that is pop-up-class.

Balsamiq also names the piece that was missing: the **modal screen**, "a
semi-transparent block that sits in between your pop-up design and the
rest of the screen… helps keep the focus on the pop-up." The popover had
no background at all, so a modal-class component was missing the one
thing that makes it read as modal. It now has a shallow one — far lighter
than the sheet scrim, because this is a preference rather than a
decision, and the wall behind stays visible and one tap from closing it.

That is also why the panel carries **no `aria-modal`**. The page behind
is plainly still live, so claiming it is inert would be a lie to a screen
reader; the light themes get a warm dim rather than a black one for the
same reason.

Sizing comes from [Digioh's recommended campaign
sizes](https://help.digioh.com/docs/recommended-sizes-for-pop-ups-on-desktop-and-mobile).
The popover is sidebar-class there — beside the content, not over it —
so it inherits their sidebar numbers: 340×200 with a ceiling of
500×500 on desktop and 360×360 on mobile. The width sits inside their
300–375px starting band at 320px (340px on mobile). The height is
`min(cap, 33.333dvh)`: a viewport percentage alone has no upper bound,
and on a 1600px-tall screen a third is 533px, past their 500px maximum.

## Eye comfort

The app bar's eye-comfort button (☾) offers eleven backgrounds. Each one
carries its whole palette, not just a colour: the canvas, the surfaces, the
ink, the hairlines and the chrome — hover plates, scrims, shadows, the
scrollbar, the FAB halo — so picking one repaints the entire interface
instead of only its background. Seven are dark (pure black is the default)
and three are light (bone, linen, mint) for bright rooms, where a black
page is itself the glare. The chrome that sits on a *photograph* — the
fullscreen viewer and the album badges — is a separate `--media-*` family and
stays dark in every theme, because there the surface under it is an image
rather than the page. The choice is stored under `gallery.comfort` and read
back into `<html data-theme>`.

Every canvas comes from one of the **ten most recent Color Hunt** submissions,
and the source code is written above each block in `style.css` so the choice
can be re-checked. The palette drives hue and the chroma budget; a per-role
OKLCh ramp supplies the luminance. That split matters more than it sounds —
not one of these ten palettes has a dark end (the darkest member across all
ten is `2a1a0e` at L 0.24), so every dark canvas is reached by ramping a
light palette down rather than by reusing a dark swatch. Canvas luminance is
solved against the themes already placed, because the picker shows them side
by side and two that render alike are one theme too many.

This set replaced fourteen themes drawn from a 2,292-palette search. The five
that went — graphite, slate, dusk, mist, paper — were the neutrals and cools,
and not one of the ten newest palettes is either.

**The landing is the request journey.** It plays `video/` full-bleed behind
seven cards, one per stage of a web request's trip — CLIENT → CAT6A → PATCH
PANEL → SWITCH → CEILING TRAY → DATA CENTER → CONNECTED — each with a plain
note for someone who has never thought about a network. A click advances;
ArrowLeft/ArrowRight walk it both ways; right-click rewinds. Each stage
carries its own **line figure** — one-weight stroke art in `stages.js`, drawn
by walking its paths, so a figure writes itself on when its card lights. Each
card also gets **one line of its own** — a leader, pointing at that card and
at nothing else, not a path from one card to the next. It draws on when the
card lights and goes when the card does, so the layer never holds more than one
stroke, and once drawn it runs a travelling dash: the line stops being a
stroke and becomes the request moving along it. No drawing library — it is
`path` data and CSS. The pointer moves three planes at three depths — the
footage least, the lines most.

The stages live in `walkthrough/stages.js`, and each one's card position is
*measured*: its frame was sampled into a 4×3 grid and scored `lum + 2 × cyan`,
so a card sits in the darkest cell holding least of the footage's own cyan
light. `cell` records which, so the choice is auditable rather than eyeballed.
The journey runtime (`walkthrough/journey.js`) is a sibling of
`walkthrough.js` rather than part of it: the cards, the line work and parallax
belong to the journey, while `walkthrough.js` keeps the ambient node-and-link
field, the way into the archive and the first-visit record the gallery's gate
reads (`walkthrough.seen` — `completed` when the journey reaches its last card,
`skipped` when the visitor takes the exit link, which is offered for exactly
that reason so the gate can never trap anyone).

The landing was not always the journey. Under it sat a seven-step slide deck
with real URLs, a numbered thumbnail rail and mirrored transitions — PowerPoint
for the Web. That layer is gone, along with the generative tree before it (a
vendored ThreeUI canvas, the project's one React island, and the only build
step the site ever had). Nothing on the site is a module any more.

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

Run the tour's test suite with `node --test` (Node 18+; same
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
- No frameworks, no build step, no dependencies — static files. Fork away.
- Tests: `node --test` runs both suites (gallery logic and the guided tour).
  Pass a glob or path to run one: `node --test "tour/*.test.mjs"`. `npm test`
  runs both. The landing journey has no suite of its own — the one that used
  to cover it went with the slide deck beneath it.