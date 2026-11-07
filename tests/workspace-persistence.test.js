"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const persistence = require("../public/avr-workspace-persistence");
const snapshot = text => ({ schemaVersion: 3, files: { "main.c": text }, authorship: {}, miniProjects: {}, current: "main.c", draftCanvas: {} });

function fixture(initial = new Map()) {
  let sequence = 0;
  const storage = { getItem: key => initial.get(key) ?? null, setItem: (key, value) => initial.set(key, value) };
  const open = () => persistence.create({ storage, createId: () => `checkpoint-${++sequence}` });
  return { values: initial, storage, open };
}

test("migration writes one new live checkpoint and keeps every old-client key read-only", () => {
  const old = JSON.stringify(snapshot("legacy"));
  const { open, values } = fixture(new Map([[persistence.LEGACY_KEYS[0], old]]));
  const store = open();
  assert.deepEqual(store.load().data, snapshot("legacy"));
  assert.equal(store.migratedFrom, persistence.LEGACY_KEYS[0]);
  const written = store.write(snapshot("legacy"));
  assert.equal(written.changed, true);
  values.set(persistence.LEGACY_KEYS[0], JSON.stringify(snapshot("old tab overwrote its own key")));
  assert.deepEqual(open().load().data, snapshot("legacy"));
  assert.equal(JSON.parse(values.get(persistence.KEY)).localCheckpoint, written.checkpoint);
});

test("unchanged writes keep checkpoint identity, while foreign writes fence both no-op and changed candidates", () => {
  const { open, values } = fixture();
  const first = open(); first.load(); first.write(snapshot("base"));
  const second = open(); second.load();
  const identity = first.checkpoint;
  assert.deepEqual(first.write(snapshot("base")), { changed: false, checkpoint: identity });
  second.write(snapshot("new work from another tab"));
  const foreign = values.get(persistence.KEY);
  assert.equal(first.owns(identity), false);
  assert.throws(() => first.write(snapshot("base")), persistence.OwnershipError);
  assert.throws(() => first.write(snapshot("stale tab edit")), persistence.OwnershipError);
  assert.equal(values.get(persistence.KEY), foreign);
});

test("checkpoint metadata is local-only and never changes the business snapshot", () => {
  const { open, values } = fixture();
  const store = open(); store.load(); store.write(snapshot("kept"));
  const envelope = JSON.parse(values.get(persistence.KEY));
  assert.deepEqual(persistence.businessData(envelope), snapshot("kept"));
  assert.deepEqual(open().load().data, snapshot("kept"));
});

test("failed storage writes leave the last checkpoint owned and observable post-write interference is detected", () => {
  const { open, storage, values } = fixture();
  const store = open(); store.load(); store.write(snapshot("base"));
  const identity = store.checkpoint;
  const set = storage.setItem;
  storage.setItem = () => { throw new Error("storage full"); };
  assert.throws(() => store.write(snapshot("unsaved")), /storage full/);
  assert.equal(store.checkpoint, identity);
  assert.equal(store.owns(), true);
  storage.setItem = (key, value) => { set(key, value); values.set(key, JSON.stringify({ ...snapshot("interleaved writer"), localCheckpoint: "foreign" })); };
  assert.throws(() => store.write(snapshot("candidate")), persistence.OwnershipError);
  assert.deepEqual(open().load().data, snapshot("interleaved writer"));
});

test("unreadable envelopes can be recovered and replaced only while the exact raw value is still owned", () => {
  for (const raw of ["{broken", "[]", "null"]) {
    const { open, values } = fixture(new Map([[persistence.KEY, raw]]));
    const store = open();
    assert.throws(() => store.load());
    assert.equal(store.sourceRaw, raw, "recovery must use the exact value that failed to parse");
    assert.equal(values.get(persistence.KEY), raw, "reading must not destroy the recovery source");
    values.set("saved-recovery", raw);
    store.write(snapshot("recovered"));
    assert.deepEqual(open().load().data, snapshot("recovered"));
    assert.equal(values.get("saved-recovery"), raw);
  }
  const { open, values } = fixture(new Map([[persistence.KEY, "{broken"]]));
  const store = open();
  assert.throws(() => store.load());
  values.set(persistence.KEY, JSON.stringify({ ...snapshot("another tab recovered"), localCheckpoint: "foreign" }));
  assert.throws(() => store.write(snapshot("stale recovery")), persistence.OwnershipError);
});
