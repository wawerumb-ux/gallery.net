//! Mouse Effect Playground — Rust (macroquad) port.
//!
//!     cargo run --release
//!
//! Controls (identical across the JS / Python / Rust builds):
//!     Move                particles drag behind the cursor
//!     Hold left + scroll  cycle the particle type (None -> Particles ->
//!                         Hearts -> Stars -> Rainbow -> None). The first
//!                         two click+scrolls stay on None; particles begin
//!                         on the 3rd.
//!     Middle-click        cycle the cursor skin (Chroma / Roblox / NextGen /
//!                         macOS / Aero)
//!     Type                letters float up from the cursor
//!     Esc                 quit
//!
//! The native twin of the web build in `mouse-effect.js`, which the gallery
//! itself loads.

use macroquad::prelude::*;

const TYPES: [&str; 7] = ["None", "None", "None", "Particles", "Hearts", "Stars", "Rainbow"];
const SKINS: [&str; 5] = ["Chroma", "Roblox", "NextGen", "macOS", "Aero"];

const PARTICLE_CAP: usize = 700;
const SPACING: f32 = 7.0;

struct Particle {
    x: f32, y: f32, vx: f32, vy: f32,
    life: f32, decay: f32,
    size: f32, spin: f32, vspin: f32,
    hue: f32, kind: &'static str,
}

struct Letter { ch: char, x: f32, y: f32, vy: f32, life: f32, decay: f32, hue: f32 }

struct Effect {
    type_idx: usize,
    skin_idx: usize,
    mouse_down: bool,
    mx: f32, my: f32,
    last_emit: (f32, f32),
    hue_base: f32,
    particles: Vec<Particle>,
    letters: Vec<Letter>,
}

/// h in degrees, s/l in 0..100 -> macroquad Color (0..1 channels).
fn hsl(h: f32, s: f32, l: f32) -> Color {
    let h = ((h % 360.0) + 360.0) % 360.0 / 360.0;
    let s = s / 100.0;
    let l = l / 100.0;
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let r = hue_to_rgb(p, q, h + 1.0 / 3.0);
    let g = hue_to_rgb(p, q, h);
    let b = hue_to_rgb(p, q, h - 1.0 / 3.0);
    Color::new(r, g, b, 1.0)
}

fn hue_to_rgb(p: f32, q: f32, mut t: f32) -> f32 {
    if t < 0.0 { t += 1.0; }
    if t > 1.0 { t -= 1.0; }
    if t < 1.0 / 6.0 { return p + (q - p) * 6.0 * t; }
    if t < 1.0 / 2.0 { return q; }
    if t < 2.0 / 3.0 { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
    p
}

impl Effect {
    fn new() -> Self {
        Effect {
            type_idx: 0, skin_idx: 0, mouse_down: false,
            mx: screen_width() / 2.0, my: screen_height() / 2.0,
            last_emit: (screen_width() / 2.0, screen_height() / 2.0),
            hue_base: 0.0, particles: Vec::new(), letters: Vec::new(),
        }
    }

    fn emit(&mut self, x: f32, y: f32, kind: &'static str) {
        let ang = rand_f32() * std::f32::consts::PI * 2.0;
        let spd = rand_f32() * 1.2 + 0.25;
        let mut vy = ang.sin() * spd * 0.5;
        if kind == "Hearts" || kind == "Stars" { vy -= 1.1; } else { vy += 0.25; }
        self.particles.push(Particle {
            x, y,
            vx: ang.cos() * spd * 0.5, vy,
            life: 1.0,
            decay: rand_f32() * 0.012 + 0.008,
            size: rand_f32() * 5.0 + 3.0,
            spin: rand_f32() * std::f32::consts::PI * 2.0,
            vspin: (rand_f32() - 0.5) * 0.18,
            hue: (self.hue_base + rand_f32() * 60.0) % 360.0,
            kind,
        });
        if self.particles.len() > PARTICLE_CAP { self.particles.remove(0); }
    }

    fn emit_trail(&mut self) {
        let kind = TYPES[self.type_idx];
        if kind == "None" { self.last_emit = (self.mx, self.my); return; }
        let (lx, ly) = self.last_emit;
        let (dx, dy) = (self.mx - lx, self.my - ly);
        let dist = (dx * dx + dy * dy).sqrt();
        if dist < SPACING { return; }
        let steps = ((dist / SPACING) as usize).min(24);
        for i in 1..=steps {
            let t = i as f32 / steps as f32;
            self.emit(lx + dx * t, ly + dy * t, kind);
        }
        self.last_emit = (self.mx, self.my);
    }

    fn update(&mut self) {
        self.hue_base = (self.hue_base + 1.2) % 360.0;
        for p in &mut self.particles {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += if p.kind == "Hearts" { 0.004 } else { 0.02 };
            p.vx *= 0.98;
            p.vy *= 0.98;
            p.spin += p.vspin;
            p.life -= p.decay;
        }
        self.particles.retain(|p| p.life > 0.0);
        for l in &mut self.letters {
            l.y += l.vy;
            l.vy *= 0.97;
            l.life -= l.decay;
        }
        self.letters.retain(|l| l.life > 0.0);
    }

    fn spawn_letter(&mut self, ch: char) {
        self.letters.push(Letter {
            ch,
            x: self.mx + (rand_f32() * 24.0 - 12.0),
            y: self.my,
            vy: -(rand_f32() * 1.1 + 1.3),
            life: 1.0, decay: 0.012,
            hue: (self.hue_base + rand_f32() * 120.0) % 360.0,
        });
    }

    fn draw(&self) {
        // Particles.
        for p in &self.particles {
            let a = p.life.clamp(0.0, 1.0);
            let (x, y, size) = (p.x, p.y, p.size);
            if p.kind == "Hearts" {
                let col = with_a(hsl(340.0 + p.hue * 0.1, 80.0, 62.0), a);
                heart(x, y, size * 2.4, col);
            } else if p.kind == "Stars" {
                let col = with_a(hsl(45.0 + p.hue * 0.05, 95.0, 65.0), a);
                star(x, y, size * 1.6, col, p.spin);
            } else {
                let hue = if p.kind == "Rainbow" { (p.hue + self.hue_base) % 360.0 } else { p.hue };
                let light = if p.kind == "Rainbow" { 66.0 } else { 60.0 };
                draw_circle(x, y, size.max(1.0), with_a(hsl(hue, 100.0, light), a));
            }
        }
        // Letters.
        for l in &self.letters {
            let col = with_a(hsl(l.hue, 90.0, 70.0), l.life.clamp(0.0, 1.0));
            let s = l.ch.to_string();
            draw_text(&s, l.x, l.y, 24.0, col);
        }
        self.draw_cursor();
    }

    fn draw_cursor(&self) {
        let skin = SKINS[self.skin_idx];
        let (x, y) = (self.mx, self.my);
        match skin {
            "Chroma" => {
                let col = hsl(self.hue_base, 100.0, 62.0);
                draw_circle_lines(x, y, 14.0, 3.0, col);
                draw_circle(x, y, 3.2, hsl(self.hue_base + 180.0, 100.0, 72.0));
            }
            "Roblox" | "macOS" => {
                let (fill, stroke) = if skin == "Roblox" {
                    (Color::new(1.0, 1.0, 1.0, 1.0), Color::new(0.08, 0.09, 0.12, 1.0))
                } else {
                    (Color::new(0.08, 0.09, 0.12, 1.0), Color::new(1.0, 1.0, 1.0, 1.0))
                };
                arrow(x, y, 1.7, fill, stroke);
            }
            "NextGen" => {
                let col = hsl((self.hue_base + 140.0) % 360.0, 100.0, 65.0);
                let rot = self.hue_base * 0.02;
                draw_circle_lines(x, y, 12.0, 2.0, col);
                for i in 0..4 {
                    let ang = (std::f32::consts::PI / 2.0) * i as f32 + rot;
                    draw_line(x + ang.cos() * 6.0, y + ang.sin() * 6.0,
                              x + ang.cos() * 18.0, y + ang.sin() * 18.0, 2.0, col);
                }
                draw_circle(x, y, 2.0, hsl((self.hue_base + 140.0) % 360.0, 100.0, 72.0));
            }
            "Aero" => {
                let col = with_a(hsl((self.hue_base + 200.0) % 360.0, 70.0, 70.0), 0.5);
                draw_circle(x, y, 16.0, col);
                draw_circle_lines(x, y, 16.0, 1.5, Color::new(1.0, 1.0, 1.0, 0.6));
                draw_circle(x - 4.0, y - 5.0, 2.4, Color::new(1.0, 1.0, 1.0, 0.95));
            }
            _ => {}
        }
    }
}

fn with_a(mut c: Color, a: f32) -> Color { c.a = a; c }

fn rand_f32() -> f32 { unsafe { macroquad::rand::rand() as f32 / u32::MAX as f32 } }

/// A heart approximated from two lobes and a downward point — cheap, and it
/// reads as a heart at the sizes particles actually reach.
fn heart(x: f32, y: f32, size: f32, col: Color) {
    let r = size * 0.28;
    draw_circle(x - r, y - r * 0.6, r, col);
    draw_circle(x + r, y - r * 0.6, r, col);
    draw_triangle((x - size * 0.55, y), (x + size * 0.55, y), (x, y + size * 0.7), col);
}

/// A five-point star as a triangle fan from the centre through ten points of
/// alternating radius.
fn star(x: f32, y: f32, r: f32, col: Color, rot: f32) {
    let mut pts = [(0.0f32, 0.0f32); 10];
    for i in 0..10 {
        let rad = if i % 2 == 1 { r * 0.45 } else { r };
        let ang = (std::f32::consts::PI / 5.0) * i as f32 - std::f32::consts::FRAC_PI_2 + rot;
        pts[i] = (x + ang.cos() * rad, y + ang.sin() * rad);
    }
    for i in 0..10 {
        let a = pts[i];
        let b = pts[(i + 1) % 10];
        draw_triangle((x, y), a, b, col);
    }
}

/// An arrow cursor built from a body and a tail triangle — close enough to the
/// familiar pointer at the scale it is drawn.
fn arrow(x: f32, y: f32, s: f32, fill: Color, stroke: Color) {
    let body = [(x, y), (x, y + 18.0 * s), (x + 13.0 * s, y + 12.0 * s)];
    let tail = [(x + 8.0 * s, y + 21.0 * s), (x + 11.0 * s, y + 19.0 * s), (x + 7.6 * s, y + 12.6 * s)];
    for tri in [body, tail] {
        draw_triangle(tri[0], tri[1], tri[2], fill);
        draw_triangle_lines(tri[0], tri[1], tri[2], 2.0, stroke);
    }
}

#[macroquad::main("Mouse Effect Playground")]
async fn main() {
    window::show_cursor(false);
    println!("Mouse Effect Playground (Rust)");
    println!("  Move                : particles trail the cursor");
    println!("  Hold left + scroll  : cycle particle type (begins on the 3rd scroll up)");
    println!("  Middle-click        : cycle cursor skin");
    println!("  Type                : letters float up");
    println!("  Esc                 : quit");

    let mut fx = Effect::new();

    loop {
        if is_key_pressed(KeyCode::Escape) { break; }

        let (mx, my) = mouse_position();
        fx.mx = mx; fx.my = my;

        if is_mouse_button_pressed(MouseButton::Left) { fx.mouse_down = true; }
        if is_mouse_button_released(MouseButton::Left) { fx.mouse_down = false; }
        if is_mouse_button_pressed(MouseButton::Middle) { fx.skin_idx = (fx.skin_idx + 1) % SKINS.len(); }

        let wheel = mouse_wheel();
        if fx.mouse_down && wheel.y != 0.0 {
            let d: i32 = if wheel.y > 0.0 { 1 } else { -1 }; // scroll up advances
            let n = TYPES.len() as i32;
            fx.type_idx = ((fx.type_idx as i32 - d).rem_euclid(n)) as usize;
        }

        while let Some(c) = get_char_pressed() {
            if !c.is_control() && !c.is_whitespace() { fx.spawn_letter(c); }
        }

        fx.emit_trail();
        fx.update();

        clear_background(Color::new(0.043, 0.055, 0.078, 1.0));
        fx.draw();

        // HUD: current type + skin, and the control hints.
        let kind = TYPES[fx.type_idx];
        let skin = SKINS[fx.skin_idx];
        let l1 = format!("Particle: {}   ·   Cursor: {}", kind, skin);
        let l2 = "Hold left + scroll to change · middle-click for skin · type to spell · Esc to quit";
        let panel_w = measure_text(&l1, None, 16, 1.0).width.max(measure_text(l2, None, 14, 1.0).width) + 24.0;
        let (px, py) = (14.0, screen_height() - 66.0);
        draw_rectangle(px, py, panel_w, 52.0, Color::new(0.039, 0.055, 0.086, 0.72));
        draw_text(&l1, px + 12.0, py + 22.0, 16.0, Color::new(0.9, 0.92, 0.95, 1.0));
        draw_text(l2, px + 12.0, py + 42.0, 14.0, Color::new(0.6, 0.64, 0.7, 1.0));

        next_frame().await;
    }
}
