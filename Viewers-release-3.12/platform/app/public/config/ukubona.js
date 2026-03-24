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
  // Ukubona extension provides its own custom study list via routes.customRoutes
  // showStudyList must be true so that the OHIF Header logo is clickable (navigates back)
  showStudyList: true,
  maxNumberOfWebWorkers: 3,
  showLoadingIndicator: true,
  showWarningMessageForCrossOrigin: false,
  showCPUFallbackMessage: false,
  strictZSpacingForVolumeViewport: true,
  groupEnabledModesFirst: true,
  allowMultiSelectExport: false,
  maxNumRequests: {
    interaction: 100,
    thumbnail: 50,
    prefetch: 25,
  },

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
