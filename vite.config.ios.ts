import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Configurazione Vite per la versione iOS.
 *
 * Differenze rispetto alla build desktop:
 *
 * - **Output IIFE e un unico file**: il bundle e' un unico script classico,
 *   non moduli ES. Serve perche' su iOS 26+ WebKit termina il processo
 *   WebContent quando una pagina servita da uno schema URL custom contiene
 *   un elemento `<script>` con `src` (bugs.webkit.org/show_bug.cgi?id=296698).
 *   Con lo script inline non viene richiesta alcuna subrisorsa.
 *
 * - **CSS in un solo file**: stessa ragione (il tag `<link>` viene inlineato
 *   nell'HTML).
 *
 * Il risultato finale e' un `index.html` autosufficiente: il passo di
 * inline e' fatto da `scripts/build-ipa.cjs`.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist-ios-web',
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});
