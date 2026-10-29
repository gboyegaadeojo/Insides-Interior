// Backup freshness (SPEC 11.3: lose at most 24 hours). The nightly export
// writes `daily/YYYY-MM-DD.sql.gz` to the backups bucket; the daily job
// warns the owners when the newest one is older than this allows.

/** Days without a new backup before the owners are told. */
export const BACKUP_GRACE_DAYS = 2;

/** The business date in a backup key, or null for anything else. */
export function backupDateOf(key: string): string | null {
  const match = /^daily\/(\d{4}-\d{2}-\d{2})\.sql\.gz$/.exec(key);
  return match ? match[1]! : null;
}

/** The newest backup date among keys, or null when there is none. */
export function newestBackup(keys: string[]): string | null {
  let newest: string | null = null;
  for (const key of keys) {
    const date = backupDateOf(key);
    if (date && (!newest || date > newest)) newest = date;
  }
  return newest;
}

/** True when the newest backup is more than BACKUP_GRACE_DAYS old (or missing). */
export function backupStale(newest: string | null, today: string): boolean {
  if (!newest) return true;
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${newest}T00:00:00Z`)) / 86_400_000;
  return days > BACKUP_GRACE_DAYS;
}
