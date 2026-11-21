import { defineConfig } from 'astro/config';
import { resolve } from 'node:path';
import { uploadedFileHeaders } from './lib/uploaded-files.mjs';
import { fileURLToPath } from 'node:url';
import { satteri } from '@astrojs/markdown-satteri';
import { markdownMath } from './lib/markdown-math.mjs';
import { markdownCode } from './lib/markdown-code.mjs';
import { friendApplicationProxy } from './scripts/friend-application-proxy.mjs';

export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  outDir: process.env.BUILD_OUTPUT_DIR || './dist',
  devToolbar: { enabled: false },
  trailingSlash: 'always',
  integrations: [{
    name: 'isolated-vite-command-cache',
    hooks: {
      'astro:config:setup': ({ config, command, updateConfig }) => {
        // Sync/check and production builds must not invalidate a running dev server's dependency URLs.
        updateConfig({ vite: { cacheDir: resolve(fileURLToPath(config.root), 'node_modules/.vite', `blog-${command}`) } });
      },
    },
  }],
  markdown: {
    processor: satteri({ features: { math: true }, mdastPlugins: [markdownMath], hastPlugins: [markdownCode] }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, wrap: true },
  },
  vite: {
    server: {
      fs: {
        // Keep Vite's default deny list; CMS credentials and applications are private.
        deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.admin/**'],
      },
    },
    plugins: [{
      name: 'public-runtime-routes',
      enforce: 'post',
      configureServer(server) {
        server.middlewares.use(uploadedFileHeaders(fileURLToPath(new URL('./public/', import.meta.url))));
        // Astro prepends its trailing-slash guard after plugin setup. Install
        // this exact API route after that, before page-only slash handling.
        return () => server.middlewares.stack.unshift({ route: '', handle: friendApplicationProxy() });
      },
    }],
    build: { chunkSizeWarningLimit: 900 },
    optimizeDeps: {
      // Home imports the archive lazily; discover all Three entry points before its first visit.
      include: [
        'three',
        'three/addons/loaders/GLTFLoader.js',
        'three/addons/environments/RoomEnvironment.js',
        'three/addons/postprocessing/EffectComposer.js',
        'three/addons/postprocessing/RenderPass.js',
        'three/addons/postprocessing/OutputPass.js',
        'three/addons/postprocessing/BokehPass.js',
        'three/addons/postprocessing/SSAOPass.js',
        'three/addons/postprocessing/Pass.js',
      ],
    },
  },
});
