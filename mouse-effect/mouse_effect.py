"""Mouse Effect Playground — Python (pygame) port.

    pip install pygame
    python mouse_effect.py

Controls (identical across the JS / Python / Rust builds):
    Move               particles drag behind the cursor
    Hold left + scroll cycle the particle type (None -> Particles -> Hearts
                       -> Stars -> Rainbow -> None). The first two
                       click+scrolls stay on None; particles begin on the 3rd.
    Middle-click       cycle the cursor skin (Chroma / Roblox / NextGen /
                       macOS / Aero)
    Type               letters float up from the cursor
    Esc                quit

This is the native twin of the web build in ../mouse-effect.js (loaded by the
gallery itself). It prints the same control hints to the console on start and
shows them in the HUD.
"""

import colorsys
import math
import random
import sys

import pygame

W, H = 1280, 720
BG = (11, 14, 20)

TYPES = ["None", "None", "None", "Particles", "Hearts", "Stars", "Rainbow"]
SKINS = ["Chroma", "Roblox", "NextGen", "macOS", "Aero"]

PARTICLE_CAP = 700
SPACING = 7


def hsl(h, s, l):
    """h (deg), s/l (0-100) -> an RGB tuple."""
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360.0, l / 100.0, s / 100.0)
    return (int(r * 255), int(g * 255), int(b * 255))


class Effect:
    def __init__(self):
        self.type_idx = 0
        self.skin_idx = 0
        self.mouse_down = False
        self.mx, self.my = W // 2, H // 2
        self.last_emit = (self.mx, self.my)
        self.hue_base = 0.0
        self.particles = []
        self.letters = []

    # ── emission ────────────────────────────────────────────────────
    def emit(self, x, y, kind):
        ang = random.random() * math.pi * 2
        spd = random.random() * 1.2 + 0.25
        vy = math.sin(ang) * spd * 0.5
        if kind in ("Hearts", "Stars"):
            vy -= 1.1
        else:
            vy += 0.25
        self.particles.append({
            "x": x, "y": y,
            "vx": math.cos(ang) * spd * 0.5, "vy": vy,
            "life": 1.0, "decay": random.random() * 0.012 + 0.008,
            "size": random.random() * 5 + 3,
            "spin": random.random() * math.pi * 2,
            "vspin": (random.random() - 0.5) * 0.18,
            "hue": (self.hue_base + random.random() * 60) % 360,
            "kind": kind,
        })
        if len(self.particles) > PARTICLE_CAP:
            self.particles.pop(0)

    def emit_trail(self):
        kind = TYPES[self.type_idx]
        if kind == "None":
            self.last_emit = (self.mx, self.my)
            return
        lx, ly = self.last_emit
        dx, dy = self.mx - lx, self.my - ly
        dist = math.hypot(dx, dy)
        if dist < SPACING:
            return
        steps = min(int(dist // SPACING), 24)
        for i in range(1, steps + 1):
            t = i / steps
            self.emit(lx + dx * t, ly + dy * t, kind)
        self.last_emit = (self.mx, self.my)

    # ── update ──────────────────────────────────────────────────────
    def update(self):
        self.hue_base = (self.hue_base + 1.2) % 360
        for p in self.particles:
            p["x"] += p["vx"]
            p["y"] += p["vy"]
            p["vy"] += 0.004 if p["kind"] == "Hearts" else 0.02
            p["vx"] *= 0.98
            p["vy"] *= 0.98
            p["spin"] += p["vspin"]
            p["life"] -= p["decay"]
        self.particles = [p for p in self.particles if p["life"] > 0]
        for l in self.letters:
            l["y"] += l["vy"]
            l["vy"] *= 0.97
            l["life"] -= l["decay"]
        self.letters = [l for l in self.letters if l["life"] > 0]

    def spawn_letter(self, ch):
        self.letters.append({
            "char": ch,
            "x": self.mx + random.uniform(-12, 12), "y": self.my,
            "vy": -random.uniform(1.3, 2.4), "life": 1.0, "decay": 0.012,
            "hue": (self.hue_base + random.random() * 120) % 360,
        })

    # ── render ──────────────────────────────────────────────────────
    def draw(self, surf, font):
        overlay = pygame.Surface((surf.get_width(), surf.get_height()), pygame.SRCALPHA)
        for p in self.particles:
            a = max(0, int(p["life"] * 255))
            x, y, size = int(p["x"]), int(p["y"]), p["size"]
            if p["kind"] == "Hearts":
                col = hsl(340 + p["hue"] * 0.1, 80, 62)
                self._heart(overlay, x, y, int(size * 2.4), col, a)
            elif p["kind"] == "Stars":
                col = hsl(45 + p["hue"] * 0.05, 95, 65)
                self._star(overlay, x, y, size * 1.6, col, a, p["spin"])
            else:
                hue = (p["hue"] + self.hue_base) % 360 if p["kind"] == "Rainbow" else p["hue"]
                col = hsl(hue, 100, 66 if p["kind"] == "Rainbow" else 60)
                pygame.draw.circle(overlay, col + (a,), (x, y), max(1, int(size)))
        surf.blit(overlay, (0, 0))

        # Letters ride on top, crisp.
        for l in self.letters:
            a = max(0, int(l["life"] * 255))
            txt = font.render(l["char"], True, hsl(l["hue"], 90, 70))
            txt.set_alpha(a)
            surf.blit(txt, txt.get_rect(center=(int(l["x"]), int(l["y"]))))

    @staticmethod
    def _heart(surf, x, y, size, col, a):
        s = size / 16.0
        pts = [(0, -3), (0, -6), (-6, -6), (-6, -1), (-6, 3), (0, 6),
               (0, 9), (0, 6), (6, 3), (6, -1), (6, -6), (0, -6), (0, -3)]
        poly = [(x + px * s, y + py * s) for px, py in pts]
        pygame.draw.polygon(surf, col + (a,), poly)

    @staticmethod
    def _star(surf, x, y, r, col, a, rot):
        pts = []
        for i in range(10):
            rad = r * 0.45 if i % 2 else r
            ang = (math.pi / 5) * i - math.pi / 2 + rot
            pts.append((x + math.cos(ang) * rad, y + math.sin(ang) * rad))
        pygame.draw.polygon(surf, col + (a,), [(int(px), int(py)) for px, py in pts])

    def draw_cursor(self, surf):
        skin = SKINS[self.skin_idx]
        x, y = int(self.mx), int(self.my)
        if skin == "Chroma":
            col = hsl(self.hue_base, 100, 62)
            pygame.draw.circle(surf, col, (x, y), 14, 3)
            pygame.draw.circle(surf, hsl(self.hue_base + 180, 100, 72), (x, y), 3)
        elif skin in ("Roblox", "macOS"):
            fill, stroke = ((255, 255, 255), (20, 24, 31)) if skin == "Roblox" \
                else ((20, 24, 31), (255, 255, 255))
            s = 1.7
            pts = [(0, 0), (0, 18), (4.4, 14), (8, 21), (11, 19), (7.6, 12.6), (13, 12)]
            poly = [(x + px * s, y + py * s) for px, py in pts]
            pygame.draw.polygon(surf, fill, [(int(a), int(b)) for a, b in poly])
            pygame.draw.polygon(surf, stroke, [(int(a), int(b)) for a, b in poly], 2)
        elif skin == "NextGen":
            col = hsl((self.hue_base + 140) % 360, 100, 65)
            rot = self.hue_base * 0.02
            pygame.draw.circle(surf, col, (x, y), 12, 2)
            for i in range(4):
                ang = (math.pi / 2) * i + rot
                pygame.draw.line(surf, col,
                                 (x + math.cos(ang) * 6, y + math.sin(ang) * 6),
                                 (x + math.cos(ang) * 18, y + math.sin(ang) * 18), 2)
            pygame.draw.circle(surf, hsl((self.hue_base + 140) % 360, 100, 72), (x, y), 2)
        elif skin == "Aero":
            col = hsl((self.hue_base + 200) % 360, 70, 70)
            pygame.draw.circle(surf, col + (120,), (x, y), 16)
            pygame.draw.circle(surf, (255, 255, 255, 200), (x, y), 16, 1)
            pygame.draw.circle(surf, (255, 255, 255, 230), (x - 4, y - 5), 2)


def main():
    pygame.init()
    pygame.display.set_caption("Mouse Effect Playground")
    screen = pygame.display.set_mode((W, H), pygame.RESIZABLE)
    clock = pygame.time.Clock()
    font = pygame.font.SysFont("system-ui", 22, bold=True)
    hud_font = pygame.font.SysFont("system-ui", 15)

    fx = Effect()

    print("Mouse Effect Playground (Python)")
    print("  Move                : particles trail the cursor")
    print("  Hold left + scroll  : cycle particle type (begins on the 3rd scroll up)")
    print("  Middle-click        : cycle cursor skin")
    print("  Type                : letters float up")
    print("  Esc                 : quit")

    running = True
    while running:
        for e in pygame.event.get():
            if e.type == pygame.QUIT:
                running = False
            elif e.type == pygame.KEYDOWN:
                if e.key == pygame.K_ESCAPE:
                    running = False
                elif e.unicode and e.unicode.isprintable() and e.unicode != " ":
                    fx.spawn_letter(e.unicode)
            elif e.type == pygame.MOUSEMOTION:
                fx.mx, fx.my = e.pos
            elif e.type == pygame.MOUSEBUTTONDOWN:
                if e.button == 1:
                    fx.mouse_down = True
                elif e.button == 2:                      # middle-click: skin
                    fx.skin_idx = (fx.skin_idx + 1) % len(SKINS)
            elif e.type == pygame.MOUSEBUTTONUP:
                if e.button == 1:
                    fx.mouse_down = False
            elif e.type == pygame.MOUSEWHEEL:            # hold left + scroll: type
                if fx.mouse_down and e.y != 0:
                    d = 1 if e.y < 0 else -1            # wheel-up advances
                    fx.type_idx = (fx.type_idx - d) % len(TYPES)
            elif e.type == pygame.VIDEORESIZE:
                screen = pygame.display.set_mode(e.size, pygame.RESIZABLE)

        fx.mx, fx.my = pygame.mouse.get_pos()
        fx.emit_trail()
        fx.update()

        screen.fill(BG)
        fx.draw(screen, font)

        kind = TYPES[fx.type_idx]
        skin = SKINS[fx.skin_idx]
        line1 = hud_font.render(f"Particle: {kind}   ·   Cursor: {skin}", True, (154, 164, 178))
        line2 = hud_font.render("Hold left + scroll to change · middle-click for skin · type to spell · Esc to quit",
                                True, (154, 164, 178))
        pad = 12
        panel_w = max(line1.get_width(), line2.get_width()) + pad * 2
        panel_h = line1.get_height() + line2.get_height() + pad * 2 + 4
        panel = pygame.Surface((panel_w, panel_h), pygame.SRCALPHA)
        panel.fill((10, 14, 22, 184))
        panel.blit(line1, (pad, pad))
        panel.blit(line2, (pad, pad + line1.get_height() + 4))
        screen.blit(panel, (14, screen.get_height() - panel_h - 14))

        pygame.display.flip()
        clock.tick(60)

    pygame.quit()
    sys.exit()


if __name__ == "__main__":
    main()
