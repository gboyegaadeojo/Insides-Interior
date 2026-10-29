import { describe, expect, it } from "vitest";
import { backupDateOf, backupStale, newestBackup } from "~/domain/backups";

describe("backup freshness (SPEC 11.3)", () => {
  it("reads dates from daily keys only", () => {
    expect(backupDateOf("daily/2026-10-29.sql.gz")).toBe("2026-10-29");
    expect(backupDateOf("monthly/2026-10.sql.gz")).toBeNull();
    expect(backupDateOf("daily/2026-10-29.sql")).toBeNull();
  });

  it("finds the newest", () => {
    expect(
      newestBackup(["daily/2026-10-27.sql.gz", "monthly/2026-10.sql.gz", "daily/2026-10-29.sql.gz"]),
    ).toBe("2026-10-29");
    expect(newestBackup([])).toBeNull();
  });

  it("is stale after the grace days, or with none at all", () => {
    expect(backupStale("2026-10-29", "2026-10-29")).toBe(false);
    expect(backupStale("2026-10-27", "2026-10-29")).toBe(false);
    expect(backupStale("2026-10-26", "2026-10-29")).toBe(true);
    expect(backupStale(null, "2026-10-29")).toBe(true);
  });
});
