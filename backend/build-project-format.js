"use strict";

const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "avr-project-format.js"));
const destination = path.join(__dirname, "../public/avr-project-format.js");
if (process.argv.includes("--check")) {
  if (!fs.existsSync(destination) || !source.equals(fs.readFileSync(destination))) {
    process.stderr.write("The shared browser project-format module is stale. Run node backend/build-project-format.js.\n");
    process.exitCode = 1;
  }
} else fs.writeFileSync(destination, source);
