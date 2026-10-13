# Notification sounds

Audio files for the notification system live here. They are referenced from
the `TOAST_SOUND_FILES` registry in `app.js`, keyed by a short action name.

## Recordings are the exception, not the rule

The app has four notification voices and **all four are synthesised** from
oscillators — `TOAST_VOICES` in `app.js`. They need no file, no licence
and no network, and they are consistent with each other by construction:
same bus peak, same envelope shape, all under a second.

This folder holds only the recordings that a synthesiser cannot do — the
download confirmation, which wants a real designed chime. Prefer a voice
in `TOAST_VOICES` unless you have a specific reason not to. A new voice
costs about eight lines of oscillator data and no licensing question at
all; a new recording costs a licence, a gitignore entry, and a manual
finding on one of the sites below.

## Where to look for a recording

If you do want one, and you want it *committed*, use **Freesound filtered
to CC0**. That is the only source on the usual list whose licence
unambiguously permits redistributing the file in a public repository:

| Source        | Attribution | Commit to a public repo |
| ------------- | ----------- | ---------------------- |
| **Freesound CC0** | none    | **yes**                |
| Freesound CC-BY | required | yes, with credit      |
| Freesound CC-BY-NC | required | yes, but non-commercial |
| Mixkit        | none       | grey — see below       |
| Pixabay       | none       | grey — see below       |
| ZapSplat free | **required** | no                    |

Mixkit and Pixabay both grant use inside an End Product — which a web app
is — while forbidding distribution of the item *standalone*. Embedding is
licensed; what is arguable is that a public repo makes the raw file
fetchable on its own. In practice nobody enforces this against a Pages
site, but it is a real reading of the text and it is your call.

ZapSplat's free tier requires attribution, so it is out unless you pay for
Gold.

## Trimming a recording for interface use

Stock SFX are made for video, not for a toast that lives eight seconds:

- trim to **~250ms**, hard — anything longer reads as lag
- **mono**; stock is often stereo and wide, interface sound is close
- **normalise peak** to a consistent level, or two clips will differ by
  several dB and the quieter will feel like the less important one
- no fade tail — the toast it belongs to has already vanished

## Which file goes where

| Action name | File                                          | Played by                                          |
| ----------- | --------------------------------------------- | -------------------------------------------------- |
| `download`  | `universfield-new-notification-02-323592.mp3` | "Saved `name`" in the viewer (`app.js`) |

Keep the vendor's filename. The item number in it is what traces the file
back to the licence it is used under.

Note that a `sound:` name can resolve two ways — a file here, or one of
the synthesised voices in `TOAST_VOICES`. `download` happens to be a
recording; `error`, `undo` and `success` are synthesised and are not
listed above.

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