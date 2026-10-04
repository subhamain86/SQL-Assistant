export type Route = 'quickstart' | 'readonly' | 'cr' | 'schema-used' | 'error-rectifier' | 'settings' | 'about';
export interface PendingConflict { id: string; schemaId: string; schemaName: string; remoteSchemaJson: string; detectedAt: string; }
export interface SyncLogEntry { id: string; timestamp: string; kind: 'pull' | 'push' | 'error'; message: string; }
