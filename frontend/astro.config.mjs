import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// Static output — built as high-performance static assets for Vercel Edge CDN.
// All dynamic audio streaming and API calls connect client-side to the Render backend.
export default defineConfig({
  output: 'static',
  integrations: [react(), tailwind()],
  server: { port: 4321, host: '127.0.0.1' },
  vite: {
    define: {
      'import.meta.env.PUBLIC_API_BASE': JSON.stringify(
        process.env.PUBLIC_API_BASE || 'http://localhost:8787',
      ),
    },
  },
});
