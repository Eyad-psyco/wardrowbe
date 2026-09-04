import packageJson from '../package.json';

/** App semver from package.json (baked into the image at build time). */
export const APP_VERSION = packageJson.version;
