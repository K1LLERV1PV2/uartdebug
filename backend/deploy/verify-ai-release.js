"use strict";

const fs = require("node:fs");
const assert = require("node:assert/strict");
const { createAvrAiService } = require("../avr-ai-service");

async function main() {
  const input = process.argv[2] === "-" ? 0 : process.argv[2];
  const actual = JSON.parse(fs.readFileSync(input, "utf8"));
  const expected = await createAvrAiService({ environment: {
    AI_MATERIALS_ROOT: process.env.AI_MATERIALS_ROOT,
  } }).getStatus();
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
  assert.equal(actual.model, "gpt-6.1-sol", "Running model differs from the configured project model");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
