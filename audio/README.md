# Notification sounds

Audio files for the notification system live here. They are referenced from
the `TOAST_SOUND_FILES` registry in `app.js`, keyed by a short action name.

## Which file goes where

| Action name | File                                          | Played by                                          |
| ----------- | --------------------------------------------- | -------------------------------------------------- |
| `download`  | `universfield-new-notification-02-323592.mp3` | "Saved `name`" in the viewer (`app.js`) |

Keep the vendor's filename. The item number in it is what traces the file
back to the licence it is used under.

## Adding another sound

1. Drop the file in this folder.
2. Add a line to `TOAST_SOUND_FILES` in `app.js`.
3. Pass `sound: '<action name>'` in the options of the `showToast` call that
   should make the noise.

Any toast with no `sound` — and any toast whose file is missing or has not
finished loading — falls back to the synthesised ding, so a broken or missing
file costs you the noise, never the message.

## Licensing

**Envato Elements assets cannot be committed to this repository.** The licence
covers your own projects, not redistribution, and this repo is public on GitHub
Pages. Keep any Envato download out of git:

- add the filename to `.gitignore` (already the case for `audio/*.mp3`), or
- keep the file local and load it from somewhere untracked

The app works with or without it — see the fallback note above.

## Format

Short, small, and trimmed. A notification is not a track:

- mp3 or m4a/aac, mono
- under ~100 KB
- under one second
- no fade-in or fade-out tail — the toast it belongs to has already vanished