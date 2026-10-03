/* ────────────────────────────────────────────────────────────────────
   download-button.js — the site's single animated download control.
   Vanilla factory with the contract's exact props shape:

     {
       href: string                        // file URL
       filename?: string                   // optional download name
       label: string                       // button text
       variant?: 'primary' | 'ghost'       // default 'primary'
       onDownloadStart?: () => void
       onDownloadComplete?: () => void
       className?: string
     }

   Every timing derives from D in oneui.js (SPEED_MULTIPLIER × 1.25).
   No icon library, no motion library: inline SVG + One UI easing.
   Reduced motion: no arrow animation, no tray pulse — the success
   state appears instantly on activation. Total perceived motion: 0ms.
   ──────────────────────────────────────────────────────────────────── */

/* The canonical icon: vertical arrow (currentColor) over a rounded
   tray (accent token). Inline SVG so the tray color tracks the token. */
const DLB_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
  + '<g class="dlb-arrow-wrap">'
  + '<path class="dlb-arrow" d="M12 4v9m0 0l-3.5-3.5M12 13l3.5-3.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
  + '</g>'
  + '<path class="dlb-check" d="M8 11.8l2.6 2.6L16 9.4" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<path class="dlb-tray" d="M5 16v1.5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5V16" fill="none" stroke="var(--dlb-accent)" stroke-width="2.2" stroke-linecap="round"/>'
  + '</svg>';

function createDownloadButton(props) {
  const variant = props.variant === 'ghost' ? 'ghost' : 'primary';
  const file = { href: props.href, filename: props.filename };

  const a = document.createElement('a');
  a.className = 'dlb dlb-' + variant + (props.className ? ' ' + props.className : '');
  a.href = file.href;
  a.setAttribute('download', file.filename || '');
  a.setAttribute('role', 'button');
  a.innerHTML = DLB_ICON + '<span class="dlb-label"></span>';
  a.querySelector('.dlb-label').textContent = props.label;

  // Durations ride on the element as custom properties — every state
  // (hover, press, activation, success) is driven by D, nothing else.
  a.style.setProperty('--dlb-short', D.short + 'ms');
  a.style.setProperty('--dlb-base', D.base + 'ms');
  a.style.setProperty('--dlb-long', D.long + 'ms');
  a.style.setProperty('--dlb-ease', ONE_UI_EASING);

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let busy = false;

  /* The sequence, single play:
       t = 0              phase 1+2 — .is-active (arrow dips over D.base,
                          tray pulses over D.base)
       t = D.long-D.base  phase 3   — .is-active removed; the same base
                          transition carries the arrow home by t = D.long
       t = D.long         fetch begins, then success or error           */
  function activate() {
    if (busy) return; // rapid double-activation never double-downloads
    busy = true;
    if (props.onDownloadStart) props.onDownloadStart();
    if (reduce) { startDownload(); return; }
    a.classList.add('is-active');
    setTimeout(() => { a.classList.remove('is-active'); }, D.long - D.base);
    setTimeout(startDownload, D.long);
  }

  async function startDownload() {
    try {
      const res = await fetch(file.href);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const tmp = document.createElement('a');
      tmp.href = url;
      tmp.setAttribute('download', file.filename || '');
      tmp.rel = 'noopener';
      document.body.appendChild(tmp);
      tmp.click();
      tmp.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      succeed();
    } catch (err) {
      fail();
    }
  }

  /* Success: tray fills accent, checkmark swaps in, holds D.long
     (the spec's "~600ms" = the long duration), then resets. */
  function succeed() {
    a.classList.add('is-success');
    if (props.onDownloadComplete) props.onDownloadComplete();
    setTimeout(() => { a.classList.remove('is-success'); busy = false; }, D.long);
  }

  /* Error: muted state only. The success state is never played. */
  function fail() {
    a.classList.add('is-error');
    setTimeout(() => { a.classList.remove('is-error'); busy = false; }, D.long);
  }

  a.addEventListener('click', (e) => { e.preventDefault(); activate(); });
  // Enter activates natively on anchors; Space needs the explicit path.
  a.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); activate(); }
  });

  return {
    el: a,
    activate, // programmatic trigger (e.g. keyboard shortcut, file ready)
    setFile(next) {
      file.href = next.href;
      file.filename = next.filename;
      a.href = next.href;
      a.setAttribute('download', next.filename || '');
    },
  };
}
