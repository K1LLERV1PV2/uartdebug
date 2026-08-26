"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

test("deployment guards database schema before rollback symlink changes", () => {
  const workflow = read(".github/workflows/deploy.yml");
  const guard = read("backend/deploy/guard-ai-access-schema-rollback.sh");
  const rollbackResolution = workflow.indexOf("rollback_target_output=");
  const bootstrapSymlink = workflow.indexOf("ts_bootstrap=", rollbackResolution);
  const rollbackSymlink = workflow.indexOf("== Rollback mode ==", rollbackResolution);

  assert.ok(rollbackResolution >= 0, "rollback guard invocation is missing");
  assert.ok(bootstrapSymlink > rollbackResolution);
  assert.ok(rollbackSymlink > bootstrapSymlink);
  assert.match(workflow, /Upload rollback database-schema guard/);
  assert.match(guard, /PRAGMA user_version;/);
  assert.match(guard, /target AI_ACCESS_SCHEMA_VERSION/);
  assert.match(guard, /restore the matching verified pre-migration/);
  assert.match(guard, /live_ai_access_schema_version.*-gt.*target_ai_access_schema_version/s);
});

test("database backups are verified and conservatively retained", () => {
  const backup = read("backend/deploy/backup-ai-access-database.sh");
  const installer = read("backend/deploy/install-ai-service.sh");
  const workflow = read(".github/workflows/deploy.yml");

  assert.match(installer, /deploy\/backup-ai-access-database\.sh/);
  assert.doesNotMatch(installer, /\.backup '\$\{backup_root\}\/ai-access\.sqlite'/);
  assert.match(backup, /retention_keep=10/);
  assert.match(
    backup,
    /\^\[0-9\]\{8\}T\[0-9\]\{6\}Z-pre-migration-\[0-9a-f\]\{7\}\$/
  );
  assert.match(backup, /resolved_retention_root.*retention_root/s);
  assert.match(backup, /PRAGMA quick_check;/);
  assert.match(backup, /candidate_version.*metadata_version/s);
  assert.match(backup, /rm -rf -- "\$\{resolved_candidate\}"/);

  const backupCall = workflow.indexOf("access_db_backup=");
  const backendSymlink = workflow.indexOf('ln -sfn "$BE_NEW" "$BE_DIR"');
  const aiRestart = workflow.indexOf("systemctl restart uartdebug-ai.service");
  assert.ok(backupCall >= 0 && backupCall < backendSymlink);
  assert.ok(backupCall < aiRestart);
});
