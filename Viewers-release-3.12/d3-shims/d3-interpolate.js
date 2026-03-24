/**
 * d3-interpolate shim
 *
 * Rspack's dev-mode lazy compilation resolves module aliases after the ESM
 * static-linking phase, so the package.json "exports" field lookup runs
 * first and only finds a subset of the real exports.
 *
 * This shim uses direct *relative file paths* (not module names) to bypass
 * the exports-field resolution entirely.  Rspack follows re-export chains
 * through file paths correctly even in lazy-compilation mode.
 */

export { default as interpolate }             from '../node_modules/d3-interpolate/src/value.js';
export { default as interpolateArray }        from '../node_modules/d3-interpolate/src/array.js';
export { default as interpolateBasis }        from '../node_modules/d3-interpolate/src/basis.js';
export { default as interpolateBasisClosed }  from '../node_modules/d3-interpolate/src/basisClosed.js';
export { default as interpolateDate }         from '../node_modules/d3-interpolate/src/date.js';
export { default as interpolateDiscrete }     from '../node_modules/d3-interpolate/src/discrete.js';
export { default as interpolateHue }          from '../node_modules/d3-interpolate/src/hue.js';
export { default as interpolateNumber }       from '../node_modules/d3-interpolate/src/number.js';
export { default as interpolateNumberArray }  from '../node_modules/d3-interpolate/src/numberArray.js';
export { default as interpolateObject }       from '../node_modules/d3-interpolate/src/object.js';
export { default as interpolateRound }        from '../node_modules/d3-interpolate/src/round.js';
export { default as interpolateString }       from '../node_modules/d3-interpolate/src/string.js';
export { interpolateTransformCss, interpolateTransformSvg } from '../node_modules/d3-interpolate/src/transform/index.js';
export { default as interpolateZoom }         from '../node_modules/d3-interpolate/src/zoom.js';
export {
  default as interpolateRgb,
  rgbBasis as interpolateRgbBasis,
  rgbBasisClosed as interpolateRgbBasisClosed,
} from '../node_modules/d3-interpolate/src/rgb.js';
export { default as interpolateHsl, hslLong as interpolateHslLong } from '../node_modules/d3-interpolate/src/hsl.js';
export { default as interpolateLab }          from '../node_modules/d3-interpolate/src/lab.js';
export { default as interpolateHcl, hclLong as interpolateHclLong } from '../node_modules/d3-interpolate/src/hcl.js';
export {
  default as interpolateCubehelix,
  cubehelixLong as interpolateCubehelixLong,
} from '../node_modules/d3-interpolate/src/cubehelix.js';
export { default as piecewise }               from '../node_modules/d3-interpolate/src/piecewise.js';
export { default as quantize }                from '../node_modules/d3-interpolate/src/quantize.js';
