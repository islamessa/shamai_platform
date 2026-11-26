/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PDFJS_ASSET_DIRS = ['standard_fonts', 'cmaps', 'wasm', 'iccs'];

/**
 * pdf.js needs a few static asset folders (standard fonts, cmaps, wasm decoders) at runtime.
 * They are served from our own origin so the app never talks to a CDN.
 */
function pdfjsAssets(): Plugin {
  const src = resolve(import.meta.dirname, 'node_modules/pdfjs-dist');
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      for (const dir of PDFJS_ASSET_DIRS) {
        server.middlewares.use(`/pdfjs/${dir}`, (req, res, next) => {
          const file = resolve(src, dir, (req.url ?? '').replace(/^\//, '').split('?')[0]);
          if (!file.startsWith(resolve(src, dir)) || !existsSync(file)) return next();
          res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
          import('node:fs').then((fs) => fs.createReadStream(file).pipe(res));
        });
      }
    },
    writeBundle(options) {
      const outDir = options.dir ?? resolve(import.meta.dirname, 'dist');
      for (const dir of PDFJS_ASSET_DIRS) {
        cpSync(resolve(src, dir), resolve(outDir, 'pdfjs', dir), { recursive: true });
      }
    },
  };
}

/**
 * Content-Security-Policy for the production build only (dev server needs inline scripts/websockets).
 * connect-src 'self' means the page cannot send data anywhere except its own static host.
 */
function cspMeta(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "connect-src 'self' blob: data:",
    "img-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' blob: data:",
    // the original extract is shown in the browser's own PDF viewer from a local blob: URL
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

export default defineConfig({
  // Relative base so the build works on GitHub Pages under /<repo>/ and on any other static host.
  base: './',
  plugins: [react(), pdfjsAssets(), cspMeta()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
