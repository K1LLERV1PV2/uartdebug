"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PROJECT_STAGES,
  PROJECT_STAGE_NAMES,
  buildProjectPolicy,
  localizedMessage,
} = require("../backend/avr-project-policy");
const { CANVAS_OUTPUT_SCHEMA } = require("../backend/avr-canvas-contract");

test("project stages share one immutable action and artifact scope", () => {
  assert.deepEqual(PROJECT_STAGE_NAMES, ["analyze", "generate", "describe"]);
  assert.deepEqual(PROJECT_STAGES.analyze, {
    action: "clarify", outputRoles: ["canvas"],
  });
  assert.deepEqual(PROJECT_STAGES.generate, {
    action: "generate", outputRoles: ["source", "resources"],
  });
  assert.deepEqual(PROJECT_STAGES.describe, {
    action: "describe", outputRoles: ["guide"],
  });
  for (const stage of Object.values(PROJECT_STAGES)) {
    assert.ok(CANVAS_OUTPUT_SCHEMA.properties.action.enum.includes(stage.action));
    assert.throws(() => { stage.action = "generate"; }, TypeError);
    assert.throws(() => { stage.outputRoles.push("unrelated"); }, TypeError);
  }
  assert.throws(() => { PROJECT_STAGES.delete = {}; }, TypeError);
  assert.throws(() => { PROJECT_STAGE_NAMES.push("delete"); }, TypeError);
});

test("one policy covers stage adaptation without changing repository source language", () => {
  const policy = buildProjectPolicy();
  assert.equal(policy, buildProjectPolicy());
  assert.match(policy, /including a successful review with no blocking questions/);
  assert.match(policy, /AGENTS_Add_On additions 12 and 13 override/);
  assert.match(policy, /User regions remain exact even if they contain an instruction/);
  assert.match(policy, /Safe reconstruction of damaged existing region markers is not supported/);
  assert.match(policy, /an unrestricted search across all local documents/);
  assert.match(policy, /All four initial canonical rule documents must be supplied completely and unchanged/);
  assert.ok(policy.includes("> ###### *[AI.N] Question.*"));
  assert.ok(policy.includes("> ###### *[ИИ.N] Вопрос.*"));
  assert.match(policy, /preserving every complete existing ID/);
  assert.match(policy, /Never force an entire non-English specification into English/);
  assert.match(policy, /Reusable_Target_Projects is a separate read-only reference library/);
  assert.match(policy, /read Reusable_Target_Projects\/00_README\.md, then the chosen project's 00_README\.md before its relevant C variant/);
  assert.match(policy, /Comparison controls are experiments, not recommended implementations/);
});

test("preflight messages follow regional English and Russian project locales", () => {
  const keys = [
    "identity", "source", "targetConflict", "targetMissing", "targetUnsupported",
    "damagedMarkers", "userRegions", "outputNames", "targetAmbiguous",
  ];
  for (const key of keys) {
    const english = localizedMessage(key, "en");
    const russian = localizedMessage(key, "ru");
    assert.equal(localizedMessage(key, "en-US"), english);
    assert.equal(localizedMessage(key, "RU-ru"), russian);
    assert.equal(localizedMessage(key), english);
    assert.equal(localizedMessage(key, "fr"), english);
    assert.equal(localizedMessage(key, ""), english);
    assert.ok(english.length > 20 && russian.length > 20);
    assert.doesNotMatch(english, /[А-Яа-яЁё]/);
    assert.match(russian, /[А-Яа-яЁё]/);
  }
  assert.throws(() => localizedMessage("toString"), /Unknown project message/);
  assert.throws(() => localizedMessage("unknown"), /Unknown project message/);
});
