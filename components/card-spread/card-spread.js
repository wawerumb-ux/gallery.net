/* ── Card Spread component — JS toggle ──
   Pure CSS does the animation; this small script toggles the spread state
   and wires the staggered start delays so each card begins a little after
   the previous one (cascading, natural motion).

   Usage:
     import { CardSpread } from './card-spread.js';
     new CardSpread('#cardSpread', { toggle: '#toggleCardSpread' });

   Or data-attribute auto-init:
     <button data-card-spread-toggle>...</button>
   (the script below self-inits on [data-card-spread-toggle] when loaded
    as a classic script). */

class CardSpread {
  constructor(root, options = {}) {
    this.root = typeof root === 'string' ? document.querySelector(root) : root;
    if (!this.root) return;

    this.toggle = options.toggle
      ? (typeof options.toggle === 'string' ? document.querySelector(options.toggle) : options.toggle)
      : this.root.closest('[data-card-spread-container]')?.querySelector('[data-card-spread-toggle]');

    this.spread = false;
    this.cards = this.root.querySelectorAll('.card-spread__card');

    if (this.toggle) {
      this.toggle.addEventListener('click', () => this.toggleSpread());
    }

    // Compute stagger delays once: forward and reverse both cascade from
    // the first card to the last, so the stack builds / collapses in order.
    this._applyStagger();
  }

  toggleSpread() {
    this.spread = !this.spread;
    this.root.classList.toggle('card-spread--spread', this.spread);
    this.toggle?.textContent = this.spread ? 'Collapse cards' : 'Spread cards';
    this.toggle?.setAttribute('aria-pressed', String(this.spread));
  }

  /* Stagger: card i starts at i * stagger. Reversed on collapse so the last
     card to appear is the first to disappear — a tidy collapse back to the
     single pile. */
  _applyStagger() {
    const stagger = getComputedStyle(this.root)
      .getPropertyValue('--cs-stagger')
      .trim() || '80ms';
    const staggerMs = parseFloat(stagger);
    this.cards.forEach((card, i) => {
      const forward = i * staggerMs;
      const reverse = (this.cards.length - 1 - i) * staggerMs;
      card.style.setProperty('--cs-stagger-start', `${forward}ms`);
      card.dataset.csReverse = `${reverse}ms`;
    });
    // When collapsing, apply the reverse stagger. When spreading, apply forward.
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'class') {
          const spreading = this.root.classList.contains('card-spread--spread');
          this.cards.forEach((card, i) => {
            card.style.setProperty(
              '--cs-stagger-start',
              spreading ? `${i * staggerMs}ms` : `${(this.cards.length - 1 - i) * staggerMs}ms`
            );
          });
          break;
        }
      }
    });
    observer.observe(this.root, { attributes: true });
  }
}

/* Auto-init for data-attribute usage. */
if (typeof document !== 'undefined') {
  document.querySelectorAll('[data-card-spread-toggle]').forEach((btn) => {
    // Find the nearest card-spread wrapper (sibling or parent-scoped).
    const spread = btn.closest('.card-spread') || btn.previousElementSibling?.closest('.card-spread');
    if (spread && !spread.__cs) {
      new CardSpread(spread, { toggle: btn });
      spread.__cs = true;
    }
  });
}

export { CardSpread };
