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
  // Use all available cores minus one (left for the main thread / UI).
  // Each worker independently decodes / decompresses one DICOM frame.
  maxNumberOfWebWorkers: Math.max(2, (navigator.hardwareConcurrency || 4) - 1),

  // ── Request concurrency ──────────────────────────────────────────────────────
  // interaction: frames the user is actively viewing — keep high so panning/
  //   zooming never waits for a network queue.
  // prefetch: aggressive parallel background loading — Orthanc is local so
  //   localhost bandwidth is effectively unlimited; fill the worker pipeline.
  // thumbnail: moderate — thumbnails matter for the study list UX.
  // compute: enough for segmentation / MPR compute tasks.
  maxNumRequests: {
    interaction: 256,
    thumbnail: 32,
    prefetch: 64,
    compute: 8,
  },

  // ── Volume cache ─────────────────────────────────────────────────────────────
  // 3 GB GPU-side cache: ~20 typical CT studies (512×512×300 ≈ 150 MB each).
  // Uses system RAM-backed GPU buffers; safe on any machine with ≥8 GB RAM.
  maxCacheSize: 3 * 1024 * 1024 * 1024,

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
        // ── Parallel frame retrieval ───────────────────────────────────────────
        // singlepart: true  → each frame fetched as a plain GET (no multipart
        // boundary parsing overhead in the WADO image loader). Orthanc supports
        // this natively via the /frames/{n}/rendered or direct single-frame path.
        // This eliminates the multipart-MIME decode step per request, which is a
        // meaningful CPU saving on large CT series.
        singlepart: 'bulkdata',
        // retrieveOptions: controls how cornerstoneWADOImageLoader batches
        // requests.  Setting a high parallelism matches our inflated prefetch
        // pool so frames stream as fast as Orthanc can serve them.
        retrieveOptions: {
          default: {
            framesPerRequest: 1,
            parallelImageRequestsPerSeries: 12,
          },
        },
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
