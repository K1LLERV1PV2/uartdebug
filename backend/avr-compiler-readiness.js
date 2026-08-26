"use strict";

const fs = require("node:fs");

function inspectCompilerReadiness({
  fileSystem = fs,
  xc8Cc,
  avrObjcopy,
  dfpPath,
} = {}) {
  const checks = {
    compiler: isExecutable(fileSystem, xc8Cc),
    objcopy: isExecutable(fileSystem, avrObjcopy),
    devicePack: isReadableDirectory(fileSystem, dfpPath),
  };
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
  };
}

function isExecutable(fileSystem, filePath) {
  if (!filePath) return false;
  try {
    fileSystem.accessSync(filePath, fileSystem.constants.X_OK);
    return fileSystem.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isReadableDirectory(fileSystem, directoryPath) {
  if (!directoryPath) return false;
  try {
    fileSystem.accessSync(
      directoryPath,
      fileSystem.constants.R_OK | fileSystem.constants.X_OK
    );
    return fileSystem.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

module.exports = { inspectCompilerReadiness };
