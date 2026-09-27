/**
 * Notices posted by a campus admin. Read-only for students, which is why every write here goes through
 * canModerate and lands in the audit log.
 */

import { getDb } from "../db/connection";
import { forbidden, notFound } from "../errors";
import { isoTimestamp } from "../domain/calendar";
import { canModerate, type Actor } from "../domain/access-rules";
import { recordAuditEntry } from "./audit";

export type Notice = {
  id: number;
  title: string;
  body: string;
  isPinned: boolean;
  authorName: string;
  createdAt: string;
  updatedAt: string;
};

export type NoticeInput = { title: string; body: string; isPinned: boolean };

type NoticeRow = {
  id: number;
  title: string;
  body: string;
  is_pinned: number;
  created_at: string;
  updated_at: string;
  author_name: string;
};

function toNotice(row: NoticeRow): Notice {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    isPinned: row.is_pinned === 1,
    authorName: row.author_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readNotice(noticeId: number): Notice {
  const row = getDb()
    .query<NoticeRow, [number]>(
      `SELECT notices.*, users.name AS author_name FROM notices
         JOIN users ON users.id = notices.author_id WHERE notices.id = ?`,
    )
    .get(noticeId);
  if (!row) throw notFound("Notice");
  return toNotice(row);
}

export function listNotices(limit = 50): Notice[] {
  return getDb()
    .query<NoticeRow, [number]>(
      `SELECT notices.*, users.name AS author_name FROM notices
         JOIN users ON users.id = notices.author_id
        ORDER BY notices.is_pinned DESC, notices.created_at DESC LIMIT ?`,
    )
    .all(limit)
    .map(toNotice);
}

export function createNotice(actor: Actor, input: NoticeInput): Notice {
  if (!canModerate(actor)) throw forbidden("Only a campus admin can post a notice.");
  const now = isoTimestamp();
  const created = getDb()
    .query<{ id: number }, [number, string, string, number, string, string]>(
      `INSERT INTO notices (author_id, title, body, is_pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(actor.id, input.title, input.body, input.isPinned ? 1 : 0, now, now);
  if (!created) throw new Error(`Notice insert by user ${actor.id} returned no row`);
  recordAuditEntry(actor.id, "notice.created", "notice", created.id, input.title);
  return readNotice(created.id);
}

export function updateNotice(actor: Actor, noticeId: number, input: NoticeInput): Notice {
  if (!canModerate(actor)) throw forbidden("Only a campus admin can edit a notice.");
  const changes = getDb().run(
    "UPDATE notices SET title = ?, body = ?, is_pinned = ?, updated_at = ? WHERE id = ?",
    [input.title, input.body, input.isPinned ? 1 : 0, isoTimestamp(), noticeId],
  ).changes;
  if (changes === 0) throw notFound("Notice");
  recordAuditEntry(actor.id, "notice.updated", "notice", noticeId, input.title);
  return readNotice(noticeId);
}

export function deleteNotice(actor: Actor, noticeId: number): void {
  if (!canModerate(actor)) throw forbidden("Only a campus admin can delete a notice.");
  const changes = getDb().run("DELETE FROM notices WHERE id = ?", [noticeId]).changes;
  if (changes === 0) throw notFound("Notice");
  recordAuditEntry(actor.id, "notice.deleted", "notice", noticeId);
}
