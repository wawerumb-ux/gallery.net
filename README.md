# Structured Cabling — Project Archive

A gallery site for your networking install photos, grouped by phase, hosted on
GitHub Pages. Public visitors (your bosses) just browse. Signing in with an
admin token lets you add or remove photos straight from the browser — no
backend, no database, just this repo.

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

- **Browsing:** open the link, click a phase in the left list to jump to it,
  click any photo for a full-size view with arrow-key navigation.
- **Adding photos:** sign in as admin, then use **+ Add photos** on any phase
  section (or **+ Create with photos** in the sidebar for a brand-new phase).
  Multi-select works.
- **Removing a photo:** while signed in, hover a photo and click the small ×
  in its corner.
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