import { config } from './config.js';
import { db } from './db.js';

/** La cuota de la API de YouTube se reinicia a medianoche, hora del Pacífico. */
export function pacificDay(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function quotaUsed(): number {
  const row = db.prepare('SELECT units FROM quota_usage WHERE day = ?').get(pacificDay()) as
    | { units: number }
    | undefined;
  return row?.units ?? 0;
}

export function addQuota(units: number): void {
  db.prepare(
    'INSERT INTO quota_usage (day, units) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET units = units + excluded.units',
  ).run(pacificDay(), units);
}

export function quotaStatus() {
  const used = quotaUsed();
  const limit = config.dailyQuotaLimit;
  return { day: pacificDay(), used, limit, remaining: Math.max(limit - used, 0) };
}
