/** Removes stale build/test artifacts. */
import { rmSync } from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const d of ['dist', '.test-build', '.diag-build']) rmSync(path.join(root, d), { recursive: true, force: true });
console.log('Cleaned dist/, .test-build/, .diag-build/.');
