// V17.7 — THE ONE controlled place that names the current application version for the tests.
// Current-version assertions (test/v177.test.mjs) compare every stamp against this constant; the constant itself is compared with package.json, so a release that forgets to bump either side fails
// loudly. Historical tests never read package.json as if it were an older release: they use explicit fixtures (test/fixtures/historical-stamps.json) or assert only the SHAPE of the stamp (/^17\.\d+(\.\d+)*$/).
// (V17.7 is stamped 17.7.0 — package.json needs a valid semantic version; the release is named V17.7, exactly as V17.6 was stamped 17.6.0.)
export const CURRENT_VERSION = '17.7.0';
export const PREVIOUS_VERSION = '17.6.9';
