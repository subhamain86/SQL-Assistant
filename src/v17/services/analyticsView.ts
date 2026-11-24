/**
 * V17.7.3 — pure helpers of the Analytics dashboard: number / duration formatting, date ranges (UTC days, like the service), the trend chart (inline SVG) and the ranking bars.
 * No DOM, no network, no storage — tested in Node. Every dynamic string that reaches markup is escaped here.
 */
import { escapeHtml as esc } from '../../utils/dom';
import type { AnalyticsSummary, SummaryRow } from './analyticsAdmin';

export const FEATURE_LABELS: Record<string, string> = {
  'quick-start': 'Quick Start', 'read-only-builder': 'Read Only Query Builder', 'cr-builder': 'Query Builder for CR', 'describe-read-only': 'Describe What You Need – Read Only', 'describe-cr': 'Describe What You Need – CR',
  'query-add': 'Add New Query', 'query-library': 'View Query Library', schema: 'Schema', github: 'GitHub Repository', 'error-rectifier': 'Error Rectifier', settings: 'Settings', about: 'About', sync: 'Sync', 'guided-walkthrough': 'Guided Walkthrough', 'copy-sql': 'Copy SQL', 'accept-learn': 'Accept & Learn',
};
export const featureLabel = (id: string): string => FEATURE_LABELS[id] || id;

export const fmtInt = (n: number): string => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0');
export const fmtRate = (r: number | null): string => (r === null || !Number.isFinite(r) ? '—' : `${(Math.round(r * 10) / 10).toString()}%`);
/** 0 → "0 s" · 45 000 → "45 s" · 125 000 → "2 min 05 s" · 3 725 000 → "1 h 02 min" */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 s'; const s = Math.round(ms / 1000); if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`; const h = Math.floor(m / 60); return `${h} h ${String(m % 60).padStart(2, '0')} min`;
}

// ───────────────────────────────────────────────────────────── date ranges (UTC days)
export type RangePreset = '7d' | '30d' | '90d' | 'month' | '365d' | 'custom';
export const RANGE_LABELS: Record<RangePreset, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', month: 'This month', '365d': 'Last 365 days', custom: 'Custom range' };
export const utcToday = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);
const dayMs = (s: string): number => Date.parse(`${s}T00:00:00Z`); const addDays = (s: string, n: number): string => new Date(dayMs(s) + n * 86_400_000).toISOString().slice(0, 10);
export function presetRange(p: Exclude<RangePreset, 'custom'>, today: string): { from: string; to: string } {
  if (p === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }; const n = p === '7d' ? 7 : p === '90d' ? 90 : p === '365d' ? 365 : 30; return { from: addDays(today, -(n - 1)), to: today };
}
const validDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dayMs(s)) && new Date(dayMs(s)).toISOString().slice(0, 10) === s;
/** '' when the range is usable, otherwise the reason (shown next to the date fields). */
export function rangeProblem(from: string, to: string): string {
  if (!validDay(from) || !validDay(to)) return 'Enter both dates.'; if (from > to) return 'The start date must not be after the end date.'; if ((dayMs(to) - dayMs(from)) / 86_400_000 + 1 > 800) return 'The range is too large (at most 800 days).'; return '';
}

// ───────────────────────────────────────────────────────────── trend chart
export interface TrendRow { label: string; users: number; sessions: number; activeMs: number }
/** Daily points for ranges up to 120 days, weekly points beyond — a chart with hundreds of points would be unreadable. */
export function trendRows(s: AnalyticsSummary): { granularity: 'day' | 'week'; rows: TrendRow[] } {
  if (s.range.days <= 120) return { granularity: 'day', rows: s.daily.map((d) => ({ label: d.date, users: d.users, sessions: d.sessions, activeMs: d.activeMs })) };
  return { granularity: 'week', rows: s.weekly.map((w) => ({ label: w.weekStart, users: w.users, sessions: w.sessions, activeMs: w.activeMs })) };
}
const niceMax = (v: number): number => { if (v <= 4) return 4; const p = 10 ** Math.floor(Math.log10(v)); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
export function trendSvg(rows: TrendRow[], granularity: 'day' | 'week' = 'day'): string {
  const W = 760; const H = 240; const L = 46; const R = 14; const T = 14; const B = 30; const pw = W - L - R; const ph = H - T - B;
  if (!rows.length || rows.every((r) => r.users === 0 && r.sessions === 0)) return `<p class="hint an-empty" data-empty>No usage was recorded in this range.</p>`;
  const max = niceMax(Math.max(...rows.map((r) => Math.max(r.users, r.sessions)))); const x = (i: number): number => L + (rows.length === 1 ? pw / 2 : (pw * i) / (rows.length - 1)); const y = (v: number): number => T + ph - (ph * v) / max;
  const line = (key: 'users' | 'sessions'): string => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(r[key]).toFixed(1)}`).join(' ');
  const pts = (key: 'users' | 'sessions', cls: string): string => rows.map((r, i) => `<circle class="${cls}" cx="${x(i).toFixed(1)}" cy="${y(r[key]).toFixed(1)}" r="${rows.length > 60 ? 1.6 : 3}"><title>${esc(r.label)}: ${fmtInt(r[key])} ${key === 'users' ? 'active users' : 'sessions'}</title></circle>`).join('');
  const ticks = [0, max / 2, max].map((v) => `<g><line class="an-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="an-axis" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmtInt(v)}</text></g>`).join('');
  const idx = rows.length === 1 ? [0] : [0, Math.floor((rows.length - 1) / 2), rows.length - 1]; const xl = [...new Set(idx)].map((i, k, a) => `<text class="an-axis" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${k === 0 && a.length > 1 ? 'start' : k === a.length - 1 && a.length > 1 ? 'end' : 'middle'}">${esc(rows[i].label)}</text>`).join('');
  return `<svg class="an-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Usage trend: active users and sessions per ${granularity}" preserveAspectRatio="xMidYMid meet">${ticks}${rows.length > 1 ? `<path class="an-line an-line-sessions" d="${line('sessions')}"/><path class="an-line an-line-users" d="${line('users')}"/>` : ''}${pts('sessions', 'an-dot an-dot-sessions')}${pts('users', 'an-dot an-dot-users')}${xl}</svg>
<div class="an-legend"><span><i class="an-swatch an-swatch-users"></i> Active users</span><span><i class="an-swatch an-swatch-sessions"></i> Sessions</span><span class="hint">per ${granularity}${granularity === 'week' ? ' (weeks start on Monday)' : ''} · UTC</span></div>`;
}

// ───────────────────────────────────────────────────────────── tables and ranking bars
export function utilizationTable(rows: (SummaryRow & { label: string })[], firstHeader: string): string {
  if (!rows.length) return '<p class="hint an-empty" data-empty>No data in this range.</p>'; const max = Math.max(1, ...rows.map((r) => r.users));
  return `<div class="data-table-scroll-wrap"><table class="data-table an-table"><thead><tr><th>${esc(firstHeader)}</th><th>Active users</th><th>Sessions</th><th>Active time</th><th>SQL generated</th><th>Success rate</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td><span class="an-cell-bar"><span class="an-cell-fill" style="width:${Math.round((r.users / max) * 100)}%"></span><b>${fmtInt(r.users)}</b></span></td><td>${fmtInt(r.sessions)}</td><td>${esc(fmtDuration(r.activeMs))}</td><td>${fmtInt(r.generations)}</td><td>${esc(r.generations ? fmtRate((r.success / r.generations) * 100) : '—')}</td></tr>`).join('')}</tbody></table></div>`;
}
export function rankingBars(items: { label: string; value: number; sub?: string }[], unit: string): string {
  const live = items.filter((i) => i.value > 0); if (!live.length) return '<p class="hint an-empty" data-empty>Nothing recorded in this range.</p>'; const max = Math.max(...live.map((i) => i.value));
  return `<ol class="an-rank">${live.map((i) => `<li><span class="an-rank-label">${esc(i.label)}</span><span class="an-rank-bar"><span class="an-rank-fill" style="width:${Math.max(2, Math.round((i.value / max) * 100))}%"></span></span><span class="an-rank-value">${fmtInt(i.value)} ${esc(i.value === 1 && unit.endsWith('s') ? unit.slice(0, -1) : unit)}${i.sub ? ` <span class="hint">${esc(i.sub)}</span>` : ''}</span></li>`).join('')}</ol>`;
}
