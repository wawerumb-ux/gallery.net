import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* The walkthrough is seven STATIC html pages with no build step, plus one
   React island (the ThreeUI GenerativeTree background) mounted on the
   landing. So the bundler does not own the site:

     - root is src, and outDir is walkthrough/shader-build
     - the seven step pages and their classic <script src> files are never
       touched; only the landing gains one <script type="module">
     - ?raw (which GenerativeTree.tsx uses to inline its own HTML source) is
       a Vite feature, which is exactly why this needs a bundler at all

   base is relative so the built asset resolves from /walkthrough/ without a
   server rewrite. */
export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../walkthrough/shader-build',
    emptyOutDir: true,
    /* Stable, unhashed names: walkthrough/index.html references them
       literally. A hashed name would 404 silently the first time anyone
       rebuilt, because nothing in the repo regenerates the HTML. */
    rollupOptions: {
      input: 'src/main.tsx',
      output: {
        entryFileNames: 'assets/shader.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (info) =>
          (info.name && info.name.endsWith('.css') ? 'assets/shader.css' : 'assets/[name][extname]'),
      },
    },
  },
});
