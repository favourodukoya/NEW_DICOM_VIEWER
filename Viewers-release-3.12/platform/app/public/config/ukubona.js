/**
 * Ukubona Viewer — Orthanc DICOMweb configuration
 *
 * Dev mode  : rsbuild proxy at same origin handles /dicom-web → Orthanc (no CORS)
 * Prod Tauri: webview loads from tauri:// so direct Orthanc URL is fine
 *
 * @type {AppTypes.Config}
 */

// Detect runtime context
const _isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const _isDevServer = window.location.protocol === 'http:';

// In dev mode (including Tauri dev), always use the rsbuild proxy to avoid CORS.
// In production Tauri builds (tauri:// or https://tauri.localhost), hit Orthanc directly.
const _orthancBase = _isDevServer
  ? window.location.origin
  : (() => {
      try {
        return localStorage.getItem('ukubona_orthanc_url') || 'http://127.0.0.1:8042';
      } catch {
        return 'http://127.0.0.1:8042';
      }
    })();

window.config = {
  name: 'ukubona',
  routerBasename: '/',
  investigationalUseDialog: { option: 'never' },
  showStudyList: true,
  showLoadingIndicator: true,
  showWarningMessageForCrossOrigin: false,
  showCPUFallbackMessage: false,
  groupEnabledModesFirst: true,
  allowMultiSelectExport: false,

  // ── GPU / rendering ──────────────────────────────────────────────────────────
  // Always use WebGL GPU path; never fall back to CPU (which is 10–20× slower).
  useCPURendering: false,
  // 16-bit normalised textures: native GPU precision for CT/MR HU values.
  // Avoids a float32 CPU-side rescale step before each upload to the GPU.
  useNorm16Texture: true,
  // Prefer GPU texture size over CPU-side accuracy; reduces data transfer per frame.
  preferSizeOverAccuracy: true,
  // Relaxed Z-spacing lets the GPU re-use cached volume slabs more aggressively.
  strictZSpacingForVolumeViewport: false,

  // ── Web workers ─────────────────────────────────────────────────────────────
  // Use as many workers as the CPU can sustain (capped at logical core count – 1).
  // More workers = more parallel DICOM decode / decompress jobs.
  maxNumberOfWebWorkers: Math.max(2, (navigator.hardwareConcurrency || 4) - 1),

  // ── Request concurrency ──────────────────────────────────────────────────────
  // High interaction concurrency so windowing/pan/zoom stay responsive while
  // volume slices are still streaming in.
  // Prefetch is kept lower to avoid saturating the local Orthanc HTTP server.
  maxNumRequests: {
    interaction: 128,
    thumbnail: 32,
    prefetch: 16,
    compute: 8,
  },

  // ── Volume cache ─────────────────────────────────────────────────────────────
  // 2 GB GPU-side cache for decoded volumes.  A typical CT study (512×512×300)
  // is ~150 MB decoded; this fits ~13 studies before eviction kicks in.
  // Adjust down if the device has less than 8 GB of system RAM.
  maxCacheSize: 2 * 1024 * 1024 * 1024,

  // ─── Extensions & Modes ──────────────────────────────────────────────────────
  extensions: ['@ukubona/extension-ukubona'],
  modes: ['@ohif/mode-basic', '@ohif/mode-segmentation'],

  // ─── Data Sources ────────────────────────────────────────────────────────────
  defaultDataSourceName: 'orthanc',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc',
      configuration: {
        friendlyName: 'Local Orthanc (Ukubona)',
        name: 'orthanc',
        wadoUriRoot: _orthancBase + '/dicom-web',
        qidoRoot: _orthancBase + '/dicom-web',
        wadoRoot: _orthancBase + '/dicom-web',
        qidoSupportsIncludeField: true,
        supportsReject: false,
        dicomUploadEnabled: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        omitQuotationForMultipartRequest: true,
        bulkDataURI: { enabled: true },
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {
        friendlyName: 'Local DICOM Files',
      },
    },
  ],

  whiteLabeling: {
    createLogoComponentFn: function (React) {
      return React.createElement('img', {
        src: '/ukubona-logo.png',
        alt: 'Ukubona',
        style: { height: '50px', objectFit: 'contain' },
      });
    },
  },
  customizationService: [
    '@ukubona/extension-ukubona.customizationModule.global',
  ],
};
