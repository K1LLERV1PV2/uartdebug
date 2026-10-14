"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DEVICE_ROOT, REQUIRED_RULES, INITIAL_KNOWLEDGE } = require("../../backend/avr-materials");

function createMaterialsFixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "uartdebug-material-fixture-"));
  const root = path.join(directory, "repository");
  fs.mkdirSync(root);
  t?.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const digest = (content) => crypto.createHash("sha256").update(content).digest("hex");
  const source = { microcontroller: { model: "ATtiny1624", package: "SOIC-14" } };
  const documents = [{ id: "datasheet", sourceId: "datasheet-test", title: "Data sheet",
    revision: "test-revision", sourceFile: "raw/source.pdf", sourceUrl: "https://example.invalid/source.pdf",
    sha256: digest("test PDF"), pageCount: 1, sections: [{ id: "gpio", title: "GPIO", level: 1, startPage: 1, endPage: 1 }],
    pages: [{ page: 1, text: "PORT output latch must be set before DIRSET. Read applicable errata.", sectionIds: ["gpio"] }] }];
  const dfp = { schemaVersion: 1, sourceId: "dfp-test", packSha256: "a".repeat(64), devices: [
    { mcu: "ATtiny1624", instances: [{ name: "PORTB", module: "PORT", registerGroups: [] }],
      modules: [{ name: "PORT", registerGroups: [{ name: "PORT", registers: [{ name: "DIRSET", bitfields: [] }] }], valueGroups: [] }] },
    { mcu: "ATtiny1626", instances: [], modules: [] },
    { mcu: "ATtiny1627", instances: [], modules: [] },
  ] };
  const files = Object.fromEntries([...REQUIRED_RULES, ...INITIAL_KNOWLEDGE].map((file) => [file, `# ${file}\n\nRequired reading ${file}.\n`]));
  Object.assign(files, {
    [`${DEVICE_ROOT}/ATtiny162x_DFP_3.4.278_Extracted_Device_Definitions.json`]: JSON.stringify(dfp, null, 2),
    [`${DEVICE_ROOT}/ATtiny162x_Datasheet_Errata_Extracted_Content.json`]: JSON.stringify({ schemaVersion: 1, documents }, null, 2),
    [`${DEVICE_ROOT}/ATtiny162x_Reviewed_Technical_Facts.json`]: JSON.stringify({ schemaVersion: 1, facts: [] }),
    [`${DEVICE_ROOT}/ATtiny162x_Primary_Sources_Manifest.json`]: JSON.stringify({ schemaVersion: 1, sources: [] }),
    [`${DEVICE_ROOT}/raw/source.pdf`]: "test PDF",
    [`${DEVICE_ROOT}/DS40002234B_Datasheet_Chapters/03_IO_Multiplexing_and_Considerations/ATtiny162x_Pin_Multiplexing.yaml`]:
      "package_columns:\n  tssop_soic_14:\n    device: ATtiny1624\n  ssop_soic_20:\n    device: ATtiny1626\n  vqfn_20:\n    device: ATtiny1626\n  vqfn_24:\n    device: ATtiny1627\npins:\n  PB1:\n    package_pins:\n      tssop_soic_14: 8\n      ssop_soic_20: 15\n      vqfn_20: 14\n      vqfn_24: 16\n",
    "MCU_Knowledge_Base/AVR/User_Examples/00_README.md": "# User examples\n\n| [01_Minimum.c](01_Minimum.c) | old.c | Minimal standalone AVR program. |\n",
    "MCU_Knowledge_Base/AVR/User_Examples/01_Minimum.c": "// Minimal program.\n#include <xc.h>\n\nint main(void)\n{\n    while (1)\n    {\n    }\n    return 0;\n}\n",
    "MCU_Knowledge_Base/AVR/GPIO.md": "# GPIO\n\nSet the output latch before DIRSET.\nConsume shared events using ATOMIC_RESTORESTATE.\n",
    "MCU_Knowledge_Base/Problems.md": "private problem SECRET_PROBLEM",
    "MCU_Knowledge_Base/AVR/Problems Ver.1.0 (ru).md": "private problem SECRET_PROBLEM",
    "Notes/private.md": "SECRET_NOTE do not include",
    "Temporary_References/tmp/pdfs/scratch.md": "SECRET_TEMP",
    "Target_Projects/Project_One/Project_One.md": "# Project Project_One\n\nProject version - Ver.1.0\n\n## Hardware requirements\nATtiny1624 SOIC-14.\n\n## Software requirements\nMinimal program. SECRET_TARGET\n",
    "Target_Projects/Project_One/Project_One.c": "#include <xc.h>\nint main(void) { while (1) {} return 0; }\n",
    "Target_Projects/Project_One/Project_One.yaml": "microcontroller:\n  model: ATtiny1624\n  package: SOIC-14\nhardware_resources: {}\nsoftware_dependencies:\n  includes:\n    - \"#include <xc.h>\"\n",
    "Target_Projects/Project_One/Project_One (description).md": "# Code description\n\nMinimal program.\n",
  }, overrides);
  const manifest = { schemaVersion: 1, repository: "Sergey-Bulanov/UartDebug2", commit: "1".repeat(40), files: {} };
  for (const [file, content] of Object.entries(files)) {
    const filename = path.join(root, file);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
    const bytes = Buffer.from(content);
    manifest.files[file] = { sha256: digest(bytes), bytes: bytes.length };
  }
  const manifestPath = path.join(directory, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return { root, directory, manifestPath, manifest, files, source };
}

module.exports = { createMaterialsFixture };
