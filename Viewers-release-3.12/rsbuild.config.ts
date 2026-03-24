import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill';
import path from 'path';
import writePluginImportsFile from './platform/app/.webpack/writePluginImportsFile';
import fs from 'fs';

const SRC_DIR = path.resolve(__dirname, './platform/app/src');
const DIST_DIR = path.resolve(__dirname, './platform/app/dist');
const PUBLIC_DIR = path.resolve(__dirname, './platform/app/public');

// Environment variables (similar to webpack.pwa.js)
const APP_CONFIG = process.env.APP_CONFIG || 'config/default.js';
const PUBLIC_URL = process.env.PUBLIC_URL || '/';

// Add these constants
const NODE_ENV = process.env.NODE_ENV;
const BUILD_NUM = process.env.CIRCLE_BUILD_NUM || '0';
const VERSION_NUMBER = fs.readFileSync(path.join(__dirname, './version.txt'), 'utf8') || '';
const COMMIT_HASH = fs.readFileSync(path.join(__dirname, './commit.txt'), 'utf8') || '';
const PROXY_TARGET = process.env.PROXY_TARGET;
const PROXY_DOMAIN = process.env.PROXY_DOMAIN;
const PROXY_PATH_REWRITE_FROM = process.env.PROXY_PATH_REWRITE_FROM;
const PROXY_PATH_REWRITE_TO = process.env.PROXY_PATH_REWRITE_TO;

// Add port constant
const OHIF_PORT = Number(process.env.OHIF_PORT || 3000);
const OHIF_OPEN = process.env.OHIF_OPEN !== 'false';

export default defineConfig({
  performance: {
    // Disabled: stale cache causes ESModulesLinkingError for d3 exports in dev mode.
    // Re-enable once the underlying rspack lazy-compilation/alias issue is resolved.
    buildCache: false,
  },
  source: {
    entry: {
      index: `${SRC_DIR}/index.js`,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      'process.env.NODE_DEBUG': JSON.stringify(process.env.NODE_DEBUG),
      'process.env.DEBUG': JSON.stringify(process.env.DEBUG),
      'process.env.PUBLIC_URL': JSON.stringify(process.env.PUBLIC_URL || '/'),
      'process.env.BUILD_NUM': JSON.stringify(BUILD_NUM),
      'process.env.VERSION_NUMBER': JSON.stringify(VERSION_NUMBER),
      'process.env.COMMIT_HASH': JSON.stringify(COMMIT_HASH),
      'process.env.USE_LOCIZE': JSON.stringify(process.env.USE_LOCIZE || ''),
      'process.env.LOCIZE_PROJECTID': JSON.stringify(process.env.LOCIZE_PROJECTID || ''),
      'process.env.LOCIZE_API_KEY': JSON.stringify(process.env.LOCIZE_API_KEY || ''),
      'process.env.REACT_APP_I18N_DEBUG': JSON.stringify(process.env.REACT_APP_I18N_DEBUG || ''),
    },
  },
  plugins: [pluginReact(), pluginNodePolyfill()],
  tools: {
    postcss: (config) => {
      const tailwindcss = require('tailwindcss');
      const autoprefixer = require('autoprefixer');
      const tailwindConfig = path.resolve(__dirname, './platform/app/tailwind.config.js');
      config.postcssOptions.plugins.push(
        tailwindcss(tailwindConfig),
        autoprefixer(),
      );
    },
    rspack: {
      experiments: {
        asyncWebAssembly: true,
      },
      module: {
        rules: [
          {
            test: /\.wasm$/,
            type: 'asset/resource',
          },
        ],
      },
      resolve: {
        fallback: {
          buffer: require.resolve('buffer'),
        },
      },
      watchOptions: {
        ignored: /node_modules\/@cornerstonejs/,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './platform/app/src'),
      '@components': path.resolve(__dirname, './platform/app/src/components'),
      '@hooks': path.resolve(__dirname, './platform/app/src/hooks'),
      '@routes': path.resolve(__dirname, './platform/app/src/routes'),
      '@state': path.resolve(__dirname, './platform/app/src/state'),
      // Fix ESModulesLinkingError for d3 in rspack dev/lazy-compilation mode.
      // Shim files use direct relative file paths which bypass the package.json
      // "exports" field resolution that causes the subset-of-exports issue.
      'd3-interpolate': path.resolve(__dirname, './d3-shims/d3-interpolate.js'),
      'd3-array': path.resolve(__dirname, './d3-shims/d3-array.js'),
    },
  },
  output: {
    copy: [
      // Copy plugin files (handled by writePluginImportsFile)
      ...(writePluginImportsFile(SRC_DIR, DIST_DIR) || []),
      // Copy public directory except config and html-templates
      {
        from: path.resolve(__dirname, 'node_modules/onnxruntime-web/dist'),
        to: `${DIST_DIR}/ort`,
        force: true,
      },
      {
        from: PUBLIC_DIR,
        to: DIST_DIR,
        globOptions: {
          ignore: ['**/config/**', '**/html-templates/**', '.DS_Store'],
        },
      },
      // Copy Google config
      {
        from: path.resolve(PUBLIC_DIR, 'config/google.js'),
        to: 'google.js',
      },
      // Copy app config
      {
        from: path.resolve(PUBLIC_DIR, APP_CONFIG),
        to: 'app-config.js',
      },
    ],
  },
  html: {
    template: path.resolve(PUBLIC_DIR, 'html-templates/index.html'),
    templateParameters: {
      PUBLIC_URL,
    },
  },
  server: {
    port: OHIF_PORT,
    open: OHIF_OPEN,
    // Configure proxy
    proxy: {
      // Proxy all Orthanc endpoints to avoid CORS in dev mode.
      '/dicom-web': {
        target: process.env.ORTHANC_URL || 'http://127.0.0.1:8042',
        changeOrigin: true,
      },
      '/studies': {
        target: process.env.ORTHANC_URL || 'http://127.0.0.1:8042',
        changeOrigin: true,
      },
      '/instances': {
        target: process.env.ORTHANC_URL || 'http://127.0.0.1:8042',
        changeOrigin: true,
      },
      '/system': {
        target: process.env.ORTHANC_URL || 'http://127.0.0.1:8042',
        changeOrigin: true,
      },
      '/tools': {
        target: process.env.ORTHANC_URL || 'http://127.0.0.1:8042',
        changeOrigin: true,
      },
      '/modalities': {
        target: process.env.ORTHANC_URL || 'http://127.0.0.1:8042',
        changeOrigin: true,
      },
      '/wado': {
        target: process.env.ORTHANC_URL || 'http://127.0.0.1:8042',
        changeOrigin: true,
      },
      // Add conditional proxy based on env vars
      ...(PROXY_TARGET && PROXY_DOMAIN
        ? {
            [PROXY_TARGET]: {
              target: PROXY_DOMAIN,
              changeOrigin: true,
              pathRewrite: {
                [`^${PROXY_PATH_REWRITE_FROM}`]: PROXY_PATH_REWRITE_TO,
              },
            },
          }
        : {}),
    },
    // Configure history API fallback
    historyApiFallback: {
      disableDotRule: true,
      index: `${PUBLIC_URL}index.html`,
    },
  },
});
