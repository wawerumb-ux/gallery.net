import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Scene } from './Scene';

/* The one React island on the site. The walkthrough's own runtime stays a
   classic <script> and is untouched; this only paints the tree behind the
   landing. */
const mount = document.getElementById('wt-shader-root');
if (mount) {
  createRoot(mount).render(
    <StrictMode>
      <Scene />
    </StrictMode>,
  );
}
