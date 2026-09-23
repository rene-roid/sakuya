import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// Relative, not @sakuya/shared/config: Vite bundles relative imports of its config, while a bare
// workspace import would be handed to Node as raw TypeScript.
import { loadConfig } from '../../packages/shared/src/config';

// Same sakuya.config.json as the server, so changing server.port or server.host there can't leave
// the proxy pointing at the old address. Read-only: the server side creates the file.
const { config } = loadConfig();

// Connect to the server over loopback when it listens on every interface; otherwise to the one
// address it bound. IPv6 literals need brackets in a URL.
const wildcard = config.server.host === '0.0.0.0' || config.server.host === '::';
const apiHost = wildcard ? '127.0.0.1' : config.server.host;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The web UI is useless on the network without the API behind it, and the API is exposed on
    // purpose when server.host is — so the two follow one setting.
    host: config.server.host,
    port: config.web.port,
    proxy: {
      '/api': {
        target: `http://${apiHost.includes(':') ? `[${apiHost}]` : apiHost}:${config.server.port}`,
        changeOrigin: true,
      },
    },
  },
});
