# Changelog — V17.7.3 (from V17.7.2)

V17.7.3 introduces optional Usage Analytics for measuring SQL Assistant adoption and utilization. The Analytics dashboard is available from the hamburger menu and protected by centralized administrator authentication. Analytics capture usage metadata only and do not capture SQL content, credentials, database results, or customer data.

Added: the Analytics menu entry, page and Administrator Authentication dialog; the analytics service; the tracker (active-use measurement, metadata only); the dashboard; the public configuration keys; workflows `deploy-analytics.yml` and a Pages step that writes `analytics.config.json` from repository variables; tests `test/v1773.test.mjs`, `scripts/browser_test_v1773.py`.
Changed: `main.ts`, `state.ts`, `navbar.ts`, `icons.ts`, `describeNeed.ts`, `readonly.ts`, `other.ts` (one-line hooks, About entry), `public/styles.css` (rules appended only), version stamps 17.7.3.
Unchanged and pinned: every other `src/ui` module, the favicon and the V17.7.2 bytes of the style sheet (`test/fixtures/ui-baseline-v1772.json`).
