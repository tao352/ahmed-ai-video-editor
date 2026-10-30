/// <reference types="vitest/config" />
import path from 'node:path';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {editorApi} from './server/api';

// React, Remotion and zod come from reel/node_modules so the preview runs the exact
// copy the renderer uses (two Reacts or two Remotions would break the Player).
const reel = (p: string) => path.resolve(import.meta.dirname, '../reel/node_modules', p);

export default defineConfig({
  plugins: [react(), editorApi()],
  resolve: {
    alias: [
      {find: /^react$/, replacement: reel('react')},
      {find: /^react\/(.*)$/, replacement: reel('react') + '/$1'},
      {find: /^react-dom$/, replacement: reel('react-dom')},
      {find: /^react-dom\/(.*)$/, replacement: reel('react-dom') + '/$1'},
      {find: /^remotion$/, replacement: reel('remotion')},
      {find: /^@remotion\/player$/, replacement: reel('@remotion/player')},
      {find: /^zod$/, replacement: reel('zod')},
    ],
    dedupe: ['react', 'react-dom', 'remotion', 'zod'],
  },
  server: {
    port: 5410,
    strictPort: true,
    fs: {allow: [path.resolve(import.meta.dirname, '..')]},
    watch: {ignored: ['**/projects/**']},
  },
  // `npm run app`: the optimised build the launcher opens (dev React is several times slower)
  preview: {port: 5411, strictPort: true},
  build: {chunkSizeWarningLimit: 4000},
  test: {environment: 'node', include: ['src/**/*.test.ts']},
});
