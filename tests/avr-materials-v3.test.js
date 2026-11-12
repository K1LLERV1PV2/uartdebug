"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { createMaterialsFixture } = require("./helpers/avr-materials-fixture");
const { createDocumentationLookup } = require("../backend/avr-documentation-lookup");
const { resolveKnowledge } = require("../backend/avr-knowledge");
const { loadMaterials, createProjectCatalog, REPOSITORY, REQUIRED_RULES_V3, sha256 } = require("../backend/avr-materials");
const { PIN_MAP, INDEX_PATH } = require("../backend/avr-materials-v3");
const { prepareProjectCatalog } = require("../backend/avr-project-catalog-build");

const gpio = "Hardware_References/ATtiny162x_DataSheet/PORT.md";
const privateTarget = "Target_Projects/Project_One/Project_One.md";
const topic = "attiny162x-port/topic/pin_control";

function fixture(t) {
  const header = mcu => `Software_References/Device_Headers/iotn${mcu}.h`;
  const headers = [1624, 1626, 1627].map(header);
  const f = createMaterialsFixture(t, {
    ...Object.fromEntries(REQUIRED_RULES_V3.map(file => [file, `# ${file}\nRequired rule.\n`])),
    ...Object.fromEntries(headers.map(file => [file,
      "#define PORTB (*(PORT_t *) 0x0420)\n#define PORTB_DIRSET _SFR_MEM8(0x0425)\n"])),
    [PIN_MAP]: JSON.stringify({
      package_columns: { tssop_soic_14: { device: "ATtiny1624" }, ssop_soic_20: { device: "ATtiny1626" },
        vqfn_24: { device: "ATtiny1627" } },
      pins: { PB1: { package_pins: { tssop_soic_14: 8, ssop_soic_20: 15, vqfn_24: 16 } } },
    }),
    "Index/Catalog.yaml": "format: AVR.global.index/0.2\n",
    "Index/README.md": "# Index\n",
    [gpio]: "# GPIO\n\nSet the output latch before DIRSET.\n",
    "Hardware_References/unindexed.md": "# Not selected by the index\n",
  });
  const index = new DatabaseSync(path.join(f.root, INDEX_PATH));
  try {
    index.exec(`
      CREATE TABLE metadata (key TEXT, value TEXT);
      CREATE TABLE inputs (path TEXT, sha256 TEXT);
      CREATE TABLE items (id TEXT, title TEXT, kind TEXT, status TEXT);
      CREATE TABLE locations (item_id TEXT, path TEXT, selector_kind TEXT, selector TEXT);
      CREATE TABLE item_terms (item_id TEXT, term_id TEXT);
      CREATE TABLE term_aliases (term_id TEXT, value TEXT);
      INSERT INTO metadata VALUES ('format', 'AVR.global.index/0.1');
      INSERT INTO term_aliases VALUES ('gpio', 'цифровой выход');
    `);
    const input = index.prepare("INSERT INTO inputs VALUES (?, ?)");
    for (const file of ["Index/Catalog.yaml", PIN_MAP, gpio, privateTarget, ...headers]) {
      input.run(file, f.manifest.files[file].sha256);
    }
    const item = index.prepare("INSERT INTO items VALUES (?, ?, ?, ?)");
    const location = index.prepare("INSERT INTO locations VALUES (?, ?, ?, ?)");
    item.run(topic, "GPIO pin control", "topic", "reviewed_subset");
    location.run(topic, gpio, "markdown_heading", "GPIO");
    index.prepare("INSERT INTO item_terms VALUES (?, 'gpio')").run(topic);
    for (const file of [...headers, privateTarget]) {
      const id = `resource/${path.posix.basename(file, path.posix.extname(file))}`;
      item.run(id, id, "material", "source-only");
      location.run(id, file, "file", "");
    }
  } finally {
    index.close();
  }
  const indexBytes = fs.readFileSync(path.join(f.root, INDEX_PATH));
  f.manifest.repository = REPOSITORY;
  f.manifest.files[INDEX_PATH] = { sha256: sha256(indexBytes), bytes: indexBytes.length };
  fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
  return f;
}

test("UartDebug3 uses its pinned index and device headers without disclosing ordinary targets", async t => {
  const f = fixture(t);
  const knowledge = loadMaterials(f);
  assert.deepEqual(knowledge.initialRules.map(rule => rule.path), REQUIRED_RULES_V3);
  assert.ok(!knowledge.documents.some(doc => /^(?:Target_Projects|MCU_Knowledge_Base)\//.test(doc.path)));
  assert.ok(!knowledge.documents.some(doc => doc.path.endsWith("unindexed.md")));
  assert.equal(resolveKnowledge({ mcu: "ATtiny1624", packageName: "SOIC-14", knowledge }).supported, true);
  const { lookup } = createDocumentationLookup({ knowledge, mcu: "ATtiny1624", enabled: false });
  const search = await lookup({ operation: "search", query: "цифровой выход" });
  assert.equal(search.indexResults[0].documentId, topic);
  const route = await lookup({ operation: "read", documentId: topic });
  assert.equal(route.topic.locations[0].documentId, gpio);
  assert.equal(route.topic.reviewStatus, "reviewed_subset");
  assert.match((await lookup({ operation: "read", documentId: gpio })).results[0].text, /DIRSET/);
  const registers = await lookup({ operation: "registers", query: "PORTB_DIRSET" });
  assert.equal(registers.documentId, "Software_References/Device_Headers/iotn1624.h");
  assert.match(registers.results[0].text, /PORTB_DIRSET/);
  assert.equal((await lookup({ operation: "read", documentId: privateTarget })).ok, false);
  assert.equal((await lookup({ operation: "read", documentId: "resource/Project_One" })).ok, false);
  assert.equal(prepareProjectCatalog(f).projects, 0);
  assert.deepEqual(createProjectCatalog(f).listProjects(), []);
});

test("UartDebug3 rejects an index built for a different file revision", t => {
  const f = fixture(t);
  const updated = Buffer.from("# GPIO\n\nChanged after indexing.\n");
  fs.writeFileSync(path.join(f.root, gpio), updated);
  f.manifest.files[gpio] = { sha256: sha256(updated), bytes: updated.length };
  fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
  assert.throws(() => loadMaterials(f), /knowledge index is stale/);
});
