export type Route = 'quickstart' | 'readonly' | 'cr' | 'schema-used' | 'error-rectifier' | 'settings' | 'about';
export type Theme = 'system' | 'light' | 'dark';
export interface WalkthroughStep { id: string; route: Route; targetSelector: string; title: string; body: string; }
export interface ToastMessage { id: string; kind: 'success' | 'error' | 'info' | 'warning'; text: string; }
export type SyncSource = 'shared-location' | 'github';
export type SyncTimeOption = 'manual' | '15m' | '30m' | '1h' | '4h' | '6h' | 'daily' | 'custom';
export interface SyncConfig { source: SyncSource; time: SyncTimeOption; customTime: string | null; }
export type SyncStatus = 'synchronized' | 'pending' | 'failed' | 'syncing' | 'never';
export interface PendingConflict { id: string; schemaId: string; schemaName: string; localVersion: string; remoteVersion: string; changedPaths: string[]; remoteSchemaJson: string; detectedAt: string; }
export type SyncLogEntryKind = 'discovery' | 'push' | 'pull' | 'error' | 'suppressed';
export interface SyncLogEntry { id: string; timestamp: string; kind: SyncLogEntryKind; message: string; }
