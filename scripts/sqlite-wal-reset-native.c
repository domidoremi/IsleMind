/*
 * Native regression for SQLite's WAL-reset race, adapted from upstream
 * test/walrestart.test at e7987a7a2c42fb375ac8ff4b1925c2c4238c925a
 * (Fossil 268c9da28706e163e2dfe65a9848e007ef4adc3cc4764042f0081830b88c4a1d).
 * Link against libexpo-sqlite.so extracted from the candidate APK, not the
 * host's SQLite. Fault 660 is the upstream test scheduling seam, not an
 * organically observed OEM race. The probe refuses an existing database.
 */
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "sqlite3.h"

static sqlite3 *writer;
static int injected;
static int write_result;

static void require(int condition, const char *message) {
  if (!condition) {
    fprintf(stderr, "FAIL: %s\n", message);
    exit(1);
  }
}

static void sql(sqlite3 *db, const char *statement) {
  char *error = NULL;
  int rc = exsqlite3_exec(db, statement, NULL, NULL, &error);
  if (rc != SQLITE_OK) {
    fprintf(stderr, "SQLite %d: %s\n", rc, error ? error : "unknown error");
    exsqlite3_free(error);
    exit(1);
  }
}

static int restart_wal(int fault) {
  if (fault == 660 && injected == 0) {
    injected++;
    write_result = exsqlite3_exec(writer,
      "UPDATE t1 SET b=randomblob(600) WHERE a<5", NULL, NULL, NULL);
  }
  return 0;
}

static void expect_text(sqlite3 *db, const char *statement, const char *expected) {
  exsqlite3_stmt *query = NULL;
  require(exsqlite3_prepare_v2(db, statement, -1, &query, NULL) == SQLITE_OK, "prepare query");
  require(exsqlite3_step(query) == SQLITE_ROW, "query must return one row");
  const unsigned char *value = exsqlite3_column_text(query, 0);
  require(value != NULL && strcmp((const char *)value, expected) == 0, statement);
  require(exsqlite3_step(query) == SQLITE_DONE, "query must not return conflicting extra rows");
  require(exsqlite3_finalize(query) == SQLITE_OK, "finalize query");
}

int main(int argc, char **argv) {
  require(argc == 2, "pass a fresh disposable database filename");
  int fd = open(argv[1], O_CREAT | O_EXCL | O_RDWR, 0600);
  require(fd >= 0, "refusing an existing or inaccessible database");
  close(fd);
  sqlite3 *checkpointer = NULL;
  require(exsqlite3_open(argv[1], &checkpointer) == SQLITE_OK, "open checkpointer");
  sql(checkpointer,
    "PRAGMA page_size=1024; PRAGMA auto_vacuum=0; PRAGMA journal_mode=wal;"
    "PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA wal_autocheckpoint=0;"
    "CREATE TABLE t1(a INTEGER PRIMARY KEY, b);"
    "WITH s(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM s WHERE i<20)"
    "INSERT INTO t1 SELECT NULL,randomblob(600) FROM s;"
    "CREATE INDEX i1 ON t1(b); PRAGMA wal_checkpoint;"
    "UPDATE t1 SET b=randomblob(600); PRAGMA wal_checkpoint;");
  require(exsqlite3_open(argv[1], &writer) == SQLITE_OK, "open independent writer");
  sql(writer, "PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0;");

  require(exsqlite3_test_control(SQLITE_TESTCTRL_FAULT_INSTALL, restart_wal) == SQLITE_OK,
    "upstream fault control must be available");
  int log_frames = -1, checkpointed_frames = -1;
  int rc = exsqlite3_wal_checkpoint_v2(checkpointer, NULL, SQLITE_CHECKPOINT_PASSIVE,
    &log_frames, &checkpointed_frames);
  exsqlite3_test_control(SQLITE_TESTCTRL_FAULT_INSTALL, (int (*)(int))NULL);
  require(rc == SQLITE_OK, "raced checkpoint must complete");
  require(injected == 1 && write_result == SQLITE_OK, "must actually reset WAL in the upstream race window");
  require(log_frames > 0 && checkpointed_frames == 0, "stale checkpoint must not advance nBackfill after WAL reset");

  sql(writer, "UPDATE t1 SET b=randomblob(600);");
  sql(checkpointer, "PRAGMA wal_checkpoint;");
  expect_text(checkpointer, "PRAGMA integrity_check", "ok");
  expect_text(checkpointer, "SELECT count(*) FROM t1", "20");
  sql(checkpointer,
    "CREATE VIRTUAL TABLE evidence_fts USING fts5(content);"
    "INSERT INTO evidence_fts VALUES('native persistence evidence'); BEGIN;");
  expect_text(checkpointer, "PRAGMA journal_mode", "wal");
  expect_text(checkpointer, "PRAGMA synchronous", "2");
  expect_text(checkpointer, "PRAGMA foreign_keys", "1");
  expect_text(checkpointer, "SELECT count(*) FROM evidence_fts WHERE evidence_fts MATCH 'persistence'", "1");
  sql(checkpointer, "COMMIT;");
  require(exsqlite3_close(writer) == SQLITE_OK, "close writer");
  require(exsqlite3_close(checkpointer) == SQLITE_OK, "close checkpointer");
  printf("{\"passed\":true,\"sqliteVersion\":\"%s\",\"fault660Calls\":%d,"
    "\"staleLogFrames\":%d,\"checkpointedAfterReset\":%d,"
    "\"integrity\":\"ok\",\"fts5\":true,\"transactionWalFullFk\":true}\n",
    exsqlite3_libversion(), injected, log_frames, checkpointed_frames);
  return 0;
}
