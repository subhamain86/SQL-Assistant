# Vendored TypeScript 5.8.3 (compiler only)

This folder is a minimal, **checksum-pinned copy of the official `typescript@5.8.3` npm package** (Apache-2.0 — see `LICENSE.txt` and `ThirdPartyNoticeText.txt`): `bin/tsc`, `lib/tsc.js`, `lib/_tsc.js` and only the `lib.*.d.ts` files that `tsconfig.json` / `tsconfig.test.json` need (`ES2021`, `DOM`, `DOM.Iterable` and what they reference).

It exists so that **building and testing SQL Assistant needs only Node ≥ 20** — no npm registry, no `npm ci`, no credentials. `scripts/toolchain.mjs` finds the compiler in this order: `$TSC_PATH` → this folder → `node_modules/typescript`; the version must equal the one `package.json` pins (5.8.3), and every file here is verified against `CHECKSUMS.json` (SHA-256) before it is used. A modified file stops the build with its name.

Use: `node scripts/tsc.mjs -p tsconfig.json --noEmit` (what `npm run typecheck` runs) · `node scripts/build.mjs`.
To upgrade, replace the folder with the same selection of files from the new package, update `package.json` and regenerate `CHECKSUMS.json`.
