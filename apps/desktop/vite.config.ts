import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import tailwindcss from '@tailwindcss/postcss';

export default defineConfig({
  plugins: [
    electron([
      {
        // Main process entry file
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
      {
        // Preload script
        entry: 'electron/preload.ts',
        onstart(options) {
          // Notify the Renderer process to reload the page when the Preload scripts build is complete
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
    ]),
    renderer(),
  ],
  css: {
    postcss: {
      plugins: [tailwindcss],
    },
  },
  build: {
    outDir: 'dist',
  },
});

