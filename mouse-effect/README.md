# Mouse Effect — the native ports

Particles trail your cursor, the cursor has a swappable aura, and typing
floats letters up from the pointer. The same effect, the same controls.

The web build is **not here any more** — it moved into the gallery itself as
[`mouse-effect.js`](../mouse-effect.js), because an effect that belongs on the
photo wall should not live in a demo folder. It is switched on from the app
bar's sparkle button (or the ⋮ menu), remembered under `gallery.mouseEffect`,
and the guided tour walks through it. This folder keeps the two native
implementations.

## Controls (the same three gestures everywhere)

| Input | Effect |
| --- | --- |
| **Move** | Particles drag behind the cursor like a comet tail. |
| **Hold left button + scroll up** | Cycle the particle type. Scroll down to step back. |
| **Middle-click** (the scroll wheel as a button) | Cycle the cursor aura/skin. |
| **Type** | Press any letter key — it floats up from the cursor and fades. |
| **Esc** | Quit (Python / Rust). In the gallery there is nothing to quit: the sparkle button switches it off. |

What the gestures *are* is shared; what they *produce* has drifted per build
and each is authoritative for itself:

| | Types | Skins |
| --- | --- | --- |
| Web (`../mouse-effect.js`) | Sparkle → Hearts → Stars → Rainbow → Embers → None | Chroma / Pulse / Sparkle / Comet / Reticle |
| Python, Rust | None ×3 → Particles → Hearts → Stars → Rainbow | Chroma / Roblox / NextGen / macOS / Aero |

The web build departs from these two in ways the ports do not need to: it
keeps the **native cursor visible** (each skin is an aura around it, so you can
still aim at a photo or a button), and it only swallows a scroll performed
**while the left button is held**, so normal page scrolling still works. Both
are explained at the top of `mouse-effect.js`.

## Run the native versions

### 1 · Python

```
pip install pygame
python mouse-effect/mouse_effect.py
```

### 2 · Rust

```
cd mouse-effect
cargo run --release
```

## Files

| File | What it is |
| --- | --- |
| `../mouse-effect.js` | The web build — the one the gallery loads. |
| `mouse_effect.py` | The Python (pygame) port. |
| `src/main.rs` | The Rust (macroquad) port. |
| `Cargo.toml` | Rust manifest. |

All three were written from one design — a trail emitted along the pointer's
path, a named list of skins, and floating letters — and they feel alike to
use, but the type and skin *names* are listed per build above rather than
guaranteed equal.
