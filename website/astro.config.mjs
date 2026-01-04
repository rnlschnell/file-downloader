// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://bulkfiledownloads.com',
  output: 'static',
  build: {
    assets: 'assets'
  },
  compressHTML: true
});
