let depth = 0;
export function beginInternalSync(): void { depth += 1; }
export function endInternalSync(): void { depth = Math.max(0, depth - 1); }
export function isInternalSyncInProgress(): boolean { return depth > 0; }
