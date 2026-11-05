"use strict";

const { loadMaterials, createProjectCatalog } = require("../avr-materials");

try {
  const materials = loadMaterials({ root: process.argv[2] });
  if (!materials.manifest?.commit || materials.initialRules?.length !== 4) {
    throw new Error("The canonical materials release is incomplete.");
  }
  if (process.argv.includes("--prepare-catalog")) {
    require("../avr-project-catalog-build").prepareProjectCatalog({ root: materials.root });
  }
  const projects = createProjectCatalog({ root: materials.root }).listProjects().length;
  process.stdout.write(JSON.stringify({ ok: true, commit: materials.manifest.commit, projects }) + "\n");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
