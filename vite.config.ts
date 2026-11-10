import { defineConfig } from 'vite';

// Relative asset paths, so dist/ works wherever it's uploaded: a domain root or a subfolder.
export default defineConfig({
  base: './',
});
