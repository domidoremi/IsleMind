const { DatabaseSync } = require('node:sqlite')
const { isAbsolute } = require('node:path')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REASONS = ['child_safety', 'hate_harassment', 'sexual_content', 'dangerous_content', 'privacy', 'other']
class ReportError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code }
}

function validateReport(value, idempotencyKey) {
  const keys = ['schemaVersion', 'reportId', 'appVersion', 'reason', 'excerpt', 'note']
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))
    || value.schemaVersion !== 1 || typeof value.reportId !== 'string' || !UUID.test(value.reportId)
    || idempotencyKey !== value.reportId || typeof value.appVersion !== 'string' || value.appVersion.length > 64
    || !/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(value.appVersion) || !REASONS.includes(value.reason)
    || typeof value.excerpt !== 'string' || !value.excerpt.trim() || value.excerpt.length > 4000
    || typeof value.note !== 'string' || value.note.length > 1000
    || !value.excerpt.isWellFormed() || !value.note.isWellFormed()) throw new ReportError(400, 'invalid_report')
  // Canonical field order, not the caller's JSON formatting. Never retain extra fields.
  return Object.fromEntries(keys.map(key => [key, value[key]]))
}

function openStore(filename, { maxReports = 10_000, maxSubmissionsPerHour = 500, now = Date.now } = {}) {
  if (!isAbsolute(filename)) throw new Error('REPORT_DB_PATH must be absolute')
  const db = new DatabaseSync(filename)
  db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    PRAGMA secure_delete=ON; PRAGMA max_page_count=131072;
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY COLLATE NOCASE, body TEXT, reason TEXT, received_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('received','action_required','no_action','purged')),
      reviewed_at INTEGER, review_note TEXT
    );
    CREATE INDEX IF NOT EXISTS reports_queue ON reports(state, received_at, id);
    CREATE TABLE IF NOT EXISTS admission (id INTEGER PRIMARY KEY CHECK(id=1), start INTEGER NOT NULL, count INTEGER NOT NULL);
  `)
  const tx = work => {
    db.exec('BEGIN IMMEDIATE')
    try { const result = work(); db.exec('COMMIT'); return result }
    catch (error) { db.exec('ROLLBACK'); throw error }
  }
  return {
    receive(report) {
      return tx(() => {
        const body = JSON.stringify(report)
        const existing = db.prepare('SELECT body, state FROM reports WHERE id=?').get(report.reportId)
        if (existing?.state === 'purged') throw new ReportError(410, 'report_removed')
        if (existing) {
          if (existing.body !== body) throw new ReportError(409, 'idempotency_conflict')
          return false
        }
        if (db.prepare('SELECT count(*) AS count FROM reports').get().count >= maxReports) throw new ReportError(503, 'capacity')
        const time = now()
        const bucket = db.prepare('SELECT start, count FROM admission WHERE id=1').get()
        const current = bucket && time - bucket.start < 3_600_000
        if (current && bucket.count >= maxSubmissionsPerHour) throw new ReportError(429, 'rate_limited')
        db.prepare('INSERT OR REPLACE INTO admission(id,start,count) VALUES(1,?,?)')
          .run(current ? bucket.start : time, current ? bucket.count + 1 : 1)
        db.prepare('INSERT INTO reports(id,body,reason,received_at,state) VALUES(?,?,?,?,?)')
          .run(report.reportId, body, report.reason, time, 'received')
        return true
      })
    },
    health() { db.prepare('SELECT 1').get() },
    stats() { return db.prepare('SELECT state, count(*) AS count, min(received_at) AS oldest FROM reports GROUP BY state').all() },
    list(state = 'received', limit = 50) {
      if (!['received', 'action_required', 'no_action', 'purged'].includes(state)
        || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ReportError(400, 'invalid_query')
      return db.prepare('SELECT id, reason, received_at, state, reviewed_at FROM reports WHERE state=? ORDER BY received_at, id LIMIT ?').all(state, limit)
    },
    show(id) {
      if (!UUID.test(id)) throw new ReportError(400, 'invalid_id')
      const row = db.prepare('SELECT * FROM reports WHERE id=?').get(id)
      if (!row) throw new ReportError(404, 'not_found')
      return { ...row, body: row.body ? JSON.parse(row.body) : null }
    },
    review(id, decision, note) {
      if (!UUID.test(id) || !['action_required', 'no_action'].includes(decision)
        || typeof note !== 'string' || !note.trim() || note.length > 2000 || !note.isWellFormed()) throw new ReportError(400, 'invalid_review')
      if (!db.prepare("UPDATE reports SET state=?, reviewed_at=?, review_note=? WHERE id=? AND state!='purged'").run(decision, now(), note, id).changes) throw new ReportError(404, 'not_found')
    },
    purge(id) {
      if (!UUID.test(id)) throw new ReportError(400, 'invalid_id')
      if (!db.prepare("UPDATE reports SET body=NULL, reason=NULL, review_note=NULL, reviewed_at=NULL, state='purged' WHERE id=?").run(id).changes) throw new ReportError(404, 'not_found')
      // Tombstone prevents an old client retry from recreating removed content.
      // WAL/backups/filesystem snapshots have separate deletion boundaries.
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    },
    close() { db.close() },
  }
}
module.exports = { openStore, validateReport, ReportError }
