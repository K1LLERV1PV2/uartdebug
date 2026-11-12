"use strict";

const { loadMaterials, createProjectCatalog, REPOSITORY, REQUIRED_RULES, REQUIRED_RULES_V3 } = require("../avr-materials");

try {
  const materials = loadMaterials({ root: process.argv[2] });
  const requiredRules = materials.repository === REPOSITORY ? REQUIRED_RULES_V3 : REQUIRED_RULES;
  if (!materials.manifest?.commit || !requiredRules.every(file => materials.initialRules.some(rule => rule.path === file))) {
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
