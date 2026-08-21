"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const zlib = require("node:zlib");

const archive = require("../public/avr-mini-project-archive.js");
const miniProjectCore = require("../public/avr-mini-projects.js");

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const PROJECT_SOURCE = [
  "//# 01_Minimum",
  "//## File Version",
  "// Version 1.2.3-d",
  "int main(void) { while (1) {} return 0; }",
  "",
].join("\r\n");

const PROJECT_GUIDE = [
  "# 01_Minimum",
  "",
  "## File Version",
  "",
  "Version 1.2.3-d",
  "",
  "## Short Project Description",
  "",
  "A minimal AVR project.",
  "",
  "![Preview](Pasted%20image.png)",
  "",
].join("\n");

const PROJECT_AI = [
  "# 01_Minimum",
  "",
  "## File Version",
  "",
  "Version 1.2.3-d",
  "",
  "## AI Summary",
  "",
  "A minimal standalone AVR program.",
  "",
].join("\n");

function validEntries(method = 8) {
  return [
    { name: "01_Minimum/", directory: true, method: 0 },
    {
      name: "01_Minimum/01_Minimum_1.2.3-d.c",
      content: PROJECT_SOURCE,
      method,
    },
    {
      name: "01_Minimum/01_Minimum_help_1.2.3-d.md",
      content: PROJECT_GUIDE,
      method,
    },
    {
      name: "01_Minimum/01_Minimum_AI_1.2.3-d.md",
      content: PROJECT_AI,
      method,
    },
    {
      name: "01_Minimum/Pasted image.png",
      content: PNG_1X1,
      method,
    },
  ];
}

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = entry.directory
      ? Buffer.alloc(0)
      : Buffer.isBuffer(entry.content)
        ? entry.content
        : Buffer.from(entry.content || "", "utf8");
    const method = entry.directory ? 0 : (entry.method ?? 8);
    const compressed = method === 8 ? zlib.deflateRawSync(content) : content;
    const flags = entry.flags ?? 0x0800;
    const extra = entry.extra || Buffer.alloc(0);
    const checksum = entry.crcOverride ?? crc32(content);
    const versionMadeBy = entry.versionMadeBy ?? ((3 << 8) | 20);
    const externalAttributes =
      entry.externalAttributes ??
      (entry.directory
        ? (((0o40755 << 16) | 0x10) >>> 0)
        : ((0o100644 << 16) >>> 0));

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.versionNeeded ?? 20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum >>> 0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    localParts.push(local, name, extra, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(versionMadeBy, 4);
    central.writeUInt16LE(entry.versionNeeded ?? 20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum >>> 0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt32LE(externalAttributes, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name, extra);

    localOffset += local.length + name.length + extra.length + compressed.length;
  }

  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralData, end]);
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

async function expectCode(input, code, options) {
  await assert.rejects(
    () => archive.parseMiniProjectArchive(input, options),
    (error) => {
      assert.equal(error.name, "MiniProjectArchiveError");
      assert.equal(error.code, code);
      return true;
    }
  );
}

test("exports the browser UMD global", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../public/avr-mini-project-archive.js"),
    "utf8"
  );
  const context = {
    window: { UartDebugAvrMiniProjectCore: miniProjectCore },
    Uint8Array,
    Uint32Array,
    DataView,
    ArrayBuffer,
    TextDecoder,
  };
  vm.runInNewContext(source, context);

  assert.equal(
    typeof context.window.UartDebugAvrMiniProjectArchive.parseMiniProjectArchive,
    "function"
  );
  assert.equal(archive.DEFAULT_LIMITS.maxEntries, 64);
});

test("parses the 01_Minimum three-file format and emits image data URLs", async () => {
  const parsed = await archive.parseMiniProjectArchive(makeZip(validEntries()));

  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.id, "01_Minimum");
  assert.equal(parsed.title, "01_Minimum");
  assert.equal(parsed.version, "1.2.3-d");
  assert.equal(parsed.summary, "A minimal AVR project.");
  assert.equal(parsed.defaultLocale, "en");
  assert.equal(parsed.files.source.name, "01_Minimum_1.2.3-d.c");
  assert.equal(parsed.files.source.content.includes("\r"), false);
  assert.equal(parsed.files.guide.role, "guide");
  assert.equal(parsed.files.guide.locale, "en");
  assert.equal(parsed.files.aiSpec.role, "aiSpec");
  assert.equal(parsed.files.aiSpec.mediaType, "text/markdown");
  assert.equal(parsed.assets.length, 1);
  assert.equal(parsed.assets[0].path, "Pasted image.png");
  assert.equal(parsed.assets[0].mediaType, "image/png");
  assert.match(parsed.assets[0].dataUrl, /^data:image\/png;base64,iVBOR/);

  const normalized = miniProjectCore.normalizeDefinition(parsed);
  assert.equal(normalized.defaultLocale, "en");
  assert.equal(normalized.guides[0].name, parsed.files.guide.name);
  assert.equal(normalized.assets[0].dataUrl, parsed.assets[0].dataUrl);
});

test("supports stored entries as well as deflate", async () => {
  const parsed = await archive.parseMiniProjectArchive(
    new Blob([makeZip(validEntries(0))])
  );
  assert.equal(parsed.files.source.content.includes("int main"), true);
  assert.equal(parsed.assets[0].byteLength, PNG_1X1.length);
});

test("parses localized help files and chooses English card copy by default", async () => {
  const localized = validEntries();
  localized[2] = {
    ...localized[2],
    name: "01_Minimum/01_Minimum_help(en)_1.2.3-d.md",
  };
  localized.splice(
    3,
    0,
    {
      name: "01_Minimum/01_Minimum_help(es)_1.2.3-d.md",
      content: PROJECT_GUIDE.replace(
        "A minimal AVR project.",
        "Un proyecto AVR mínimo."
      ),
    },
    {
      name: "01_Minimum/01_Minimum_help(ru)_1.2.3-d.md",
      content: PROJECT_GUIDE.replace(
        "A minimal AVR project.",
        "Минимальный проект AVR."
      ),
    }
  );

  const parsed = await archive.parseMiniProjectArchive(makeZip(localized));

  assert.equal(parsed.defaultLocale, "en");
  assert.equal(parsed.summary, "A minimal AVR project.");
  assert.ok(Array.isArray(parsed.files.guide));
  assert.deepEqual(
    parsed.files.guide.map((guide) => guide.locale),
    ["en", "es", "ru"]
  );
  assert.deepEqual(
    parsed.files.guide.map((guide) => guide.label),
    ["English", "Español", "Русский"]
  );

  const normalized = miniProjectCore.normalizeDefinition(parsed);
  assert.equal(normalized.guides.length, 3);
  assert.equal(normalized.files.guide.locale, "en");
});

test("rejects traversal, absolute paths, and case-insensitive duplicates", async () => {
  const traversal = validEntries();
  traversal[1] = { ...traversal[1], name: "../01_Minimum.c" };
  await expectCode(makeZip(traversal), "PATH_TRAVERSAL");

  const absolute = validEntries();
  absolute[1] = { ...absolute[1], name: "C:/01_Minimum.c" };
  await expectCode(makeZip(absolute), "PATH_TRAVERSAL");

  const duplicate = validEntries();
  duplicate.push({
    name: "01_minimum/PASTED IMAGE.PNG",
    content: PNG_1X1,
    method: 0,
  });
  await expectCode(makeZip(duplicate), "DUPLICATE_PATH");
});

test("rejects encrypted, ZIP64, symlink, and special-file entries", async () => {
  const encrypted = validEntries();
  encrypted[1] = { ...encrypted[1], flags: 0x0801 };
  await expectCode(makeZip(encrypted), "ENCRYPTION_NOT_ALLOWED");

  const zip64 = validEntries();
  zip64[1] = {
    ...zip64[1],
    extra: Buffer.from([0x01, 0x00, 0x00, 0x00]),
  };
  await expectCode(makeZip(zip64), "ZIP64_NOT_ALLOWED");

  const symlink = validEntries();
  symlink.push({
    name: "01_Minimum/link.png",
    content: "Pasted image.png",
    method: 0,
    externalAttributes: (0o120777 << 16) >>> 0,
  });
  await expectCode(makeZip(symlink), "SYMLINK_NOT_ALLOWED");

  const fifo = validEntries();
  fifo.push({
    name: "01_Minimum/pipe.png",
    content: "pipe",
    method: 0,
    externalAttributes: (0o010644 << 16) >>> 0,
  });
  await expectCode(makeZip(fifo), "SPECIAL_FILE_NOT_ALLOWED");
});

test("rejects nested archives by extension or by magic bytes", async () => {
  const byName = validEntries();
  byName.push({ name: "01_Minimum/payload.zip", content: "not important" });
  await expectCode(makeZip(byName), "NESTED_ARCHIVE");

  const byMagic = validEntries();
  byMagic.push({
    name: "01_Minimum/disguised.png",
    content: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
    method: 0,
  });
  await expectCode(makeZip(byMagic), "NESTED_ARCHIVE");
});

test("enforces path, count, archive, extracted, text, image, and ratio limits", async () => {
  const zip = makeZip(validEntries());
  await expectCode(zip, "TOO_MANY_ENTRIES", { limits: { maxEntries: 4 } });
  await expectCode(zip, "ARCHIVE_TOO_LARGE", {
    limits: { maxArchiveBytes: zip.length - 1 },
  });
  await expectCode(zip, "TEXT_TOO_LARGE", { limits: { maxTextBytes: 16 } });
  await expectCode(zip, "INVALID_PATH", { limits: { maxPathLength: 20 } });
  await expectCode(zip, "ENTRY_TOO_LARGE", {
    limits: { maxEntryUncompressedBytes: 64 },
  });
  await expectCode(zip, "TOTAL_SIZE_EXCEEDED", {
    limits: { maxTotalUncompressedBytes: 128 },
  });
  await expectCode(zip, "IMAGE_TOO_LARGE", {
    limits: { maxImageBytes: 16 },
  });

  const highRatio = validEntries();
  highRatio[1] = { ...highRatio[1], content: "A".repeat(4000) };
  await expectCode(makeZip(highRatio), "COMPRESSION_RATIO_EXCEEDED", {
    limits: { maxCompressionRatio: 2 },
  });
});

test("verifies CRC-32 and raster image signatures", async () => {
  const badCrc = validEntries();
  badCrc[1] = { ...badCrc[1], crcOverride: 0x12345678 };
  await expectCode(makeZip(badCrc), "CRC_MISMATCH");

  const badImage = validEntries();
  badImage[4] = { ...badImage[4], content: "not a PNG", method: 0 };
  await expectCode(makeZip(badImage), "INVALID_IMAGE");
});

test("requires one source, one or more matching guides, and one AI file", async () => {
  await expectCode(makeZip(validEntries().slice(0, -2)), "INVALID_PROJECT");

  const duplicateSource = validEntries();
  duplicateSource.push({
    name: "01_Minimum/second.c",
    content: PROJECT_SOURCE,
  });
  await expectCode(makeZip(duplicateSource), "INVALID_PROJECT");

  const mismatched = validEntries();
  mismatched[3] = {
    ...mismatched[3],
    name: "01_Minimum/02_Other_AI_1.2.3-d.md",
  };
  await expectCode(makeZip(mismatched), "MISMATCHED_PROJECT_FILES");
});

test("rejects unsupported project files and invalid UTF-8 text", async () => {
  const unsupported = validEntries();
  unsupported.push({ name: "01_Minimum/readme.txt", content: "extra" });
  await expectCode(makeZip(unsupported), "UNSUPPORTED_PROJECT_FILE");

  const invalidUtf8 = validEntries();
  invalidUtf8[1] = {
    ...invalidUtf8[1],
    content: Buffer.from([0xc3, 0x28]),
    method: 0,
  };
  await expectCode(makeZip(invalidUtf8), "INVALID_TEXT");
});
