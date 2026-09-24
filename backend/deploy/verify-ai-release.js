"use strict";

const fs = require("node:fs");
const assert = require("node:assert/strict");
const { createAvrAiService } = require("../avr-ai-service");

async function main() {
  const actual = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const expected = await createAvrAiService({ environment: {} }).getStatus();
  assert.ok(
    expected.rules?.digest && expected.knowledge?.digest,
    "Release knowledge is unavailable",
  );
  assert.equal(
    actual.contract,
    expected.contract,
    "Running canvas contract differs from the release",
  );
  assert.equal(
    actual.rules?.digest,
    expected.rules.digest,
    "Running canvas rules differ from the release",
  );
  assert.equal(
    actual.knowledge?.digest,
    expected.knowledge.digest,
    "Running knowledge differs from the release",
  );
  assert.equal(
    actual.knowledge?.version,
    expected.knowledge.version,
    "Running knowledge version differs from the release",
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
