# Mouse Effect Playground

Particles trail your cursor, the cursor itself is a swappable skin, and typing
floats letters up from the pointer. One effect, three implementations — same
controls in each.

The **web version** (`index.html`) runs in the browser with no install and opens
with a built-in step-by-step guide that teaches the controls (re-open it anytime
with the **?** button, top right).

## Controls (identical across all three)

| Input | Effect |
| --- | --- |
| **Move** | Particles drag behind the cursor like a comet tail. |
| **Hold left button + scroll up** | Cycle the particle type: `None → Particles → Hearts → Stars → Rainbow → None`. The first two click+scrolls stay on `None`; the particles begin on the **3rd** scroll up. Scroll down to step back. |
| **Middle-click** (the scroll wheel as a button) | Cycle the cursor skin: `Chroma / Roblox / NextGen / macOS / Aero`. |
| **Type** | Press any letter key — it floats up from the cursor and fades. |
| **Esc** | Quit (Python / Rust). In the browser it just closes the guide. |

## Run each version

### 1 · JavaScript (no install)

Open `index.html` in any browser:

```
open mouse-effect/index.html      # macOS
xdg-open mouse-effect/index.html  # Linux
start mouse-effect\index.html     # Windows
```

### 2 · Python

```
pip install pygame
python mouse-effect/mouse_effect.py
```

### 3 · Rust

```
cd mouse-effect
cargo run --release
```

## Files

| File | What it is |
| --- | --- |
| `index.html` | The browser playground (canvas + HUD + built-in guide). |
| `mouse-effect.css` | Styles for the page, HUD and guide. |
| `mouse-effect.js` | The effect engine and the guide logic. |
| `mouse_effect.py` | The Python (pygame) port. |
| `src/main.rs` | The Rust (macroquad) port. |
| `Cargo.toml` | Rust manifest. |

All three builds share the same particle model (`TYPES`), skin list (`SKINS`),
trail-based emission, and floating-letter behaviour, so they feel identical to
use.
