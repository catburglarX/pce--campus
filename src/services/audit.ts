/**
 * Audit trail for actions a student cannot undo: hiding a review, changing a complaint's status,
 * promoting an account. Moderation on a review site is only trustworthy if it leaves a record.
 */

import { getDb } from "../db/connection";
import { isoTimestamp } from "../domain/calendar";

export type AuditEntry = {
  id: number;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: number | null;
  detail: string;
  createdAt: string;
};

type AuditRow = {
  id: number;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: number | null;
  detail: string;
  created_at: string;
};

export function recordAuditEntry(
  actorId: number | null,
  action: string,
  targetType: string,
  targetId: number | null,
  detail = "",
): void {
  getDb().run(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [actorId, action, targetType, targetId, detail.slice(0, 500), isoTimestamp()],
  );
}

export function listAuditEntries(limit = 100): AuditEntry[] {
  return getDb()
    .query<AuditRow, [number]>(
      `SELECT audit_log.id, users.name AS actor_name, audit_log.action, audit_log.target_type,
              audit_log.target_id, audit_log.detail, audit_log.created_at
         FROM audit_log
         LEFT JOIN users ON users.id = audit_log.actor_id
        ORDER BY audit_log.id DESC
        LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({
      id: row.id,
      actorName: row.actor_name,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      detail: row.detail,
      createdAt: row.created_at,
    }));
}
