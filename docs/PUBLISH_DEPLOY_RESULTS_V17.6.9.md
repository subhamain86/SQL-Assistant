# Publish / deployment results — V17.6.9

| Target | Executed? | Result |
|---|---|---|
| GitHub Actions run of `deploy-pages.yml` | **No** | Not executed — no access to GitHub from the build environment. The workflow parses as YAML; step order, `needs` / `if` conditions, absence of `continue-on-error`, failure annotations and summary are asserted by `test/v1769.test.mjs`. |
| GitHub Pages deployment | **No** | Not executed. The publication artifact `release/` was verified locally by `npm run verify:artifact` (byte-identical outputs, 404 fallback, `.nojekyll`, `version.json`, Azure SWA / IIS deep-link config, self-contained page, CSP hash, no secret). |
| Basware publishing zone `basware/dh-zone` → `bw-publish-zone` | **No** | The reference could not be read from the build environment. **No detail of that target is claimed.** Compatibility with its required structure must be confirmed by its owner. |
| Azure broker deployment (`deploy-broker.yml`) | **No** | **Blocked: `AZURE_CREDENTIALS` is not configured** in the target repository/environment (per the supplied log `logs_104050659931`). The V17.6.9 preflight reports this as `Deployment blocked: AZURE_CREDENTIALS is not configured.`; verified by running the preflight script locally with an empty value (exit 1, no secret printed) and with all values set (exit 0). |
| PAT verification (`verify-repo-pat.yml`) | **No** (no new run) | The supplied log shows HTTP 403 / `AADSTS53003`. Local diagnostic test with the same upstream message: reported as a failed verification with the safe ids; PAT never printed. **An administrator must resolve the Conditional Access / enterprise policy; source changes cannot.** |
| `publish-data.yml` (published data folder) | **No** | Not executed; `scripts/publish-data.mjs` is covered by the existing Node tests (unchanged). |

## Outstanding external configuration blockers
1. Configure the repository / environment secret `AZURE_CREDENTIALS` (service-principal JSON for `azure/login`), plus any other key the preflight names.
2. Resolve the organization's Conditional Access / token policy for `SQLA_GITHUB_PAT` (approval, SSO authorization, enterprise PAT policy, IP allow list, resource owner — **which one applies is not verified**).
3. Remove the leftovers of earlier versions from the repository (`node scripts/prune-orphans.mjs --delete && node scripts/prune-stale.mjs --delete`, review `docs/STALE_FILES_V17.6.9.md` first) — otherwise `npm run check:stale` fails the build by design.
4. For published-copy-only deployments: publish one explicit Admin Password reset record before the first administrator starts (`docs/ADMIN_PASSWORD.md`).
5. Confirm the publication structure with the owner of `bw-publish-zone`.
