"use strict";

const { loadMaterials } = require("../avr-materials");

try {
  const materials = loadMaterials({ root: process.argv[2] });
  if (!materials.manifest?.commit || materials.initialRules?.length !== 4) {
    throw new Error("The canonical materials release is incomplete.");
  }
  process.stdout.write(JSON.stringify({ ok: true, commit: materials.manifest.commit }) + "\n");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
