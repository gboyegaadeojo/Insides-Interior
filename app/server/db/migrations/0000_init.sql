-- Phase 0: intentionally empty first migration. Tables arrive in phase 2 (SPEC 8.2).
-- D1 rejects a migration with no statements, so this is a no-op.
SELECT 1;
