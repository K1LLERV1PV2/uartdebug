(function (root, factory) {
  "use strict";

  const miniProjectCore =
    typeof module === "object" && module.exports
      ? require("./avr-mini-projects.js")
      : root?.UartDebugAvrMiniProjectCore;
  const archive = factory(miniProjectCore);

  if (typeof module === "object" && module.exports) {
    module.exports = archive;
  }

  if (root) {
    root.UartDebugAvrMiniProjectArchive = archive;
  }
})(typeof window !== "undefined" ? window : null, function (miniProjectCore) {
  "use strict";

  if (
    !miniProjectCore ||
    typeof miniProjectCore.extractShortProjectDescription !== "function"
  ) {
    throw new Error("AVR mini-project core must be loaded before ZIP support.");
  }

  const SIGNATURES = Object.freeze({
    LOCAL_FILE: 0x04034b50,
    CENTRAL_FILE: 0x02014b50,
    END_OF_CENTRAL_DIRECTORY: 0x06054b50,
    ZIP64_END_OF_CENTRAL_DIRECTORY: 0x06064b50,
    ZIP64_LOCATOR: 0x07064b50,
  });

  const METHODS = Object.freeze({
    STORED: 0,
    DEFLATE: 8,
  });

  const DEFAULT_LIMITS = Object.freeze({
    maxArchiveBytes: 16 * 1024 * 1024,
    maxEntries: 64,
    maxPathLength: 240,
    maxPathComponentLength: 120,
    maxEntryUncompressedBytes: 5 * 1024 * 1024,
    maxTotalUncompressedBytes: 16 * 1024 * 1024,
    maxTextBytes: 1024 * 1024,
    maxImageBytes: 5 * 1024 * 1024,
    maxCompressionRatio: 200,
  });

  const IMAGE_EXTENSIONS = Object.freeze({
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  });

  const LIMIT_NAMES = Object.freeze(Object.keys(DEFAULT_LIMITS));
  const CRC_TABLE = createCrcTable();

  class MiniProjectArchiveError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "MiniProjectArchiveError";
      this.code = code;
    }
  }

  /**
   * Parse a UartDebug mini-project ZIP without trusting paths or metadata in it.
   *
   * The returned object is directly compatible with normalizeDefinition() from
   * avr-mini-projects.js. The optional `assets` array contains verified raster
   * images represented by data URLs for a Markdown renderer.
   */
  async function parseMiniProjectArchive(input, options) {
    const limits = resolveLimits(options && options.limits);
    const archiveBytes = await toUint8Array(input);

    if (archiveBytes.byteLength > limits.maxArchiveBytes) {
      fail(
        "ARCHIVE_TOO_LARGE",
        `ZIP archive exceeds the ${limits.maxArchiveBytes}-byte limit.`
      );
    }
    if (archiveBytes.byteLength < 22) {
      fail("INVALID_ZIP", "The file is not a complete ZIP archive.");
    }

    const records = parseCentralDirectory(archiveBytes, limits);
    const files = [];

    for (const record of records) {
      if (record.isDirectory) continue;

      rejectNestedArchiveName(record.path);
      const data = await extractRecord(archiveBytes, record);
      rejectNestedArchiveMagic(data, record.path);
      files.push({
        path: record.path,
        data,
        crc32: record.crc32,
      });
    }

    return buildMiniProjectDefinition(files, limits);
  }

  function parseCentralDirectory(bytes, limits) {
    const view = dataViewFor(bytes);
    const eocdOffset = findEndOfCentralDirectory(bytes, view);

    if (
      eocdOffset >= 20 &&
      readUint32(view, eocdOffset - 20) === SIGNATURES.ZIP64_LOCATOR
    ) {
      fail("ZIP64_NOT_ALLOWED", "ZIP64 archives are not supported.");
    }

    const diskNumber = readUint16(view, eocdOffset + 4);
    const centralDirectoryDisk = readUint16(view, eocdOffset + 6);
    const entriesOnDisk = readUint16(view, eocdOffset + 8);
    const entryCount = readUint16(view, eocdOffset + 10);
    const centralSize = readUint32(view, eocdOffset + 12);
    const centralOffset = readUint32(view, eocdOffset + 16);

    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
      fail("MULTI_DISK_NOT_ALLOWED", "Multi-disk ZIP archives are not supported.");
    }
    if (
      entriesOnDisk === 0xffff ||
      entryCount === 0xffff ||
      centralSize === 0xffffffff ||
      centralOffset === 0xffffffff
    ) {
      fail("ZIP64_NOT_ALLOWED", "ZIP64 archives are not supported.");
    }
    if (entryCount === 0) {
      fail("INVALID_PROJECT", "The ZIP archive is empty.");
    }
    if (entryCount > limits.maxEntries) {
      fail(
        "TOO_MANY_ENTRIES",
        `ZIP archive contains more than ${limits.maxEntries} entries.`
      );
    }

    const centralEnd = checkedAdd(centralOffset, centralSize, bytes.byteLength);
    if (centralEnd !== eocdOffset) {
      fail("INVALID_ZIP", "ZIP central directory boundaries are inconsistent.");
    }

    let cursor = centralOffset;
    let totalUncompressed = 0;
    const records = [];

    for (let index = 0; index < entryCount; index += 1) {
      assertRange(cursor, 46, centralEnd);
      if (readUint32(view, cursor) !== SIGNATURES.CENTRAL_FILE) {
        fail("INVALID_ZIP", "ZIP central directory entry is malformed.");
      }

      const versionMadeBy = readUint16(view, cursor + 4);
      const versionNeeded = readUint16(view, cursor + 6);
      const flags = readUint16(view, cursor + 8);
      const method = readUint16(view, cursor + 10);
      const crc32Value = readUint32(view, cursor + 16);
      const compressedSize = readUint32(view, cursor + 20);
      const uncompressedSize = readUint32(view, cursor + 24);
      const nameLength = readUint16(view, cursor + 28);
      const extraLength = readUint16(view, cursor + 30);
      const commentLength = readUint16(view, cursor + 32);
      const diskStart = readUint16(view, cursor + 34);
      const externalAttributes = readUint32(view, cursor + 38);
      const localHeaderOffset = readUint32(view, cursor + 42);
      const variableLength = nameLength + extraLength + commentLength;
      const recordEnd = checkedAdd(cursor + 46, variableLength, centralEnd);

      if (!nameLength) {
        fail("INVALID_PATH", "ZIP entries must have a file name.");
      }
      rejectUnsupportedFeatures({
        versionNeeded,
        flags,
        method,
        compressedSize,
        uncompressedSize,
        diskStart,
        localHeaderOffset,
      });

      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
      const rawName = decodeEntryName(nameBytes, Boolean(flags & 0x0800));
      const isDirectoryByName = rawName.endsWith("/");
      const hostSystem = versionMadeBy >>> 8;
      const unixMode = (externalAttributes >>> 16) & 0xffff;
      const unixType = unixMode & 0xf000;
      const isDirectoryByAttributes = Boolean(externalAttributes & 0x10);

      if (hostSystem === 3 && unixType === 0xa000) {
        fail("SYMLINK_NOT_ALLOWED", `Symbolic links are not allowed: ${rawName}`);
      }
      if (
        hostSystem === 3 &&
        unixType !== 0 &&
        unixType !== 0x4000 &&
        unixType !== 0x8000
      ) {
        fail("SPECIAL_FILE_NOT_ALLOWED", `Special ZIP entries are not allowed: ${rawName}`);
      }

      const unixDirectory = hostSystem === 3 && unixType === 0x4000;
      const unixRegularFile = hostSystem === 3 && unixType === 0x8000;
      const isDirectory = isDirectoryByName || isDirectoryByAttributes || unixDirectory;

      if (
        (isDirectory && unixRegularFile) ||
        (!isDirectory && unixDirectory) ||
        (isDirectoryByAttributes && !isDirectoryByName)
      ) {
        fail("INVALID_ZIP", `ZIP entry type is inconsistent: ${rawName}`);
      }
      if (isDirectory && (compressedSize !== 0 || uncompressedSize !== 0)) {
        fail("INVALID_ZIP", `ZIP directory contains file data: ${rawName}`);
      }
      if (isDirectory && (method !== METHODS.STORED || crc32Value !== 0)) {
        fail("INVALID_ZIP", `ZIP directory metadata is invalid: ${rawName}`);
      }
      if (method === METHODS.STORED && compressedSize !== uncompressedSize) {
        fail("INVALID_ZIP", `Stored ZIP entry has inconsistent sizes: ${rawName}`);
      }
      if (uncompressedSize > limits.maxEntryUncompressedBytes) {
        fail(
          "ENTRY_TOO_LARGE",
          `ZIP entry exceeds the per-file size limit: ${rawName}`
        );
      }
      if (
        uncompressedSize > 0 &&
        (compressedSize === 0 ||
          uncompressedSize / compressedSize > limits.maxCompressionRatio)
      ) {
        fail(
          "COMPRESSION_RATIO_EXCEEDED",
          `ZIP entry exceeds the compression-ratio limit: ${rawName}`
        );
      }

      totalUncompressed += uncompressedSize;
      if (
        !Number.isSafeInteger(totalUncompressed) ||
        totalUncompressed > limits.maxTotalUncompressedBytes
      ) {
        fail(
          "TOTAL_SIZE_EXCEEDED",
          `ZIP archive exceeds the ${limits.maxTotalUncompressedBytes}-byte extracted-size limit.`
        );
      }

      const extraStart = cursor + 46 + nameLength;
      parseExtraFields(bytes, extraStart, extraLength);
      const safePath = validateArchivePath(rawName, isDirectory, limits);

      records.push({
        path: safePath,
        pathKey: canonicalPathKey(safePath),
        isDirectory,
        flags,
        method,
        crc32: crc32Value,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        centralNameBytes: nameBytes,
      });
      cursor = recordEnd;
    }

    if (cursor !== centralEnd) {
      fail("INVALID_ZIP", "ZIP central directory has unexpected trailing data.");
    }

    validateArchiveTree(records);
    attachLocalDataRanges(bytes, view, records, centralOffset);
    return records;
  }

  function findEndOfCentralDirectory(bytes, view) {
    const earliest = Math.max(0, bytes.byteLength - 22 - 0xffff);

    for (let offset = bytes.byteLength - 22; offset >= earliest; offset -= 1) {
      if (readUint32(view, offset) !== SIGNATURES.END_OF_CENTRAL_DIRECTORY) {
        continue;
      }

      const commentLength = readUint16(view, offset + 20);
      if (offset + 22 + commentLength === bytes.byteLength) return offset;
    }

    fail("INVALID_ZIP", "ZIP end-of-central-directory record was not found.");
  }

  function rejectUnsupportedFeatures(entry) {
    if (
      entry.compressedSize === 0xffffffff ||
      entry.uncompressedSize === 0xffffffff ||
      entry.localHeaderOffset === 0xffffffff ||
      entry.diskStart === 0xffff ||
      entry.versionNeeded >= 45
    ) {
      fail("ZIP64_NOT_ALLOWED", "ZIP64 or another extended ZIP format is not supported.");
    }
    if (entry.diskStart !== 0) {
      fail("MULTI_DISK_NOT_ALLOWED", "Multi-disk ZIP archives are not supported.");
    }
    if (entry.flags & 0x2041) {
      fail("ENCRYPTION_NOT_ALLOWED", "Encrypted ZIP entries are not supported.");
    }
    if (entry.flags & ~0x080e) {
      fail("UNSUPPORTED_ZIP_FEATURE", "ZIP entry uses unsupported general-purpose flags.");
    }
    if (entry.method !== METHODS.STORED && entry.method !== METHODS.DEFLATE) {
      fail(
        "UNSUPPORTED_COMPRESSION",
        `ZIP compression method ${entry.method} is not supported.`
      );
    }
    if (entry.method === METHODS.STORED && entry.flags & 0x0006) {
      fail("INVALID_ZIP", "Stored ZIP entries contain invalid compression flags.");
    }
  }

  function parseExtraFields(bytes, start, length) {
    const view = dataViewFor(bytes);
    const end = checkedAdd(start, length, bytes.byteLength);
    let cursor = start;

    while (cursor < end) {
      assertRange(cursor, 4, end);
      const fieldId = readUint16(view, cursor);
      const fieldLength = readUint16(view, cursor + 2);
      cursor += 4;
      assertRange(cursor, fieldLength, end);

      if (fieldId === 0x0001) {
        fail("ZIP64_NOT_ALLOWED", "ZIP64 extra fields are not supported.");
      }
      cursor += fieldLength;
    }
  }

  function validateArchivePath(rawPath, isDirectory, limits) {
    if (typeof rawPath !== "string" || !rawPath || rawPath.includes("\0")) {
      fail("INVALID_PATH", "ZIP entry has an invalid path.");
    }
    if (rawPath.includes("\\") || rawPath.startsWith("/") || /^[a-z]:/i.test(rawPath)) {
      fail("PATH_TRAVERSAL", `Absolute ZIP paths are not allowed: ${rawPath}`);
    }

    const pathWithoutTrailingSlash = isDirectory
      ? rawPath.replace(/\/+$/, "")
      : rawPath;
    if (!pathWithoutTrailingSlash || pathWithoutTrailingSlash.length > limits.maxPathLength) {
      fail("INVALID_PATH", `ZIP path is empty or too long: ${rawPath}`);
    }

    const segments = pathWithoutTrailingSlash.split("/");
    for (const segment of segments) {
      if (!segment || segment === "." || segment === "..") {
        fail("PATH_TRAVERSAL", `Unsafe ZIP path is not allowed: ${rawPath}`);
      }
      if (
        segment.length > limits.maxPathComponentLength ||
        /[<>:"|?*\x00-\x1f]/.test(segment) ||
        /[. ]$/.test(segment)
      ) {
        fail("INVALID_PATH", `ZIP path contains an unsafe name: ${rawPath}`);
      }

      const windowsStem = segment.split(".")[0].toUpperCase();
      if (
        /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(windowsStem)
      ) {
        fail("INVALID_PATH", `ZIP path uses a reserved file name: ${rawPath}`);
      }
    }

    let normalized = pathWithoutTrailingSlash;
    if (typeof normalized.normalize === "function") normalized = normalized.normalize("NFC");
    return normalized + (isDirectory ? "/" : "");
  }

  function validateArchiveTree(records) {
    const byPath = new Map();

    for (const record of records) {
      const key = record.pathKey.replace(/\/$/, "");
      if (byPath.has(key)) {
        fail("DUPLICATE_PATH", `ZIP archive contains a duplicate path: ${record.path}`);
      }
      byPath.set(key, record);
    }

    for (const record of records) {
      const segments = record.pathKey.replace(/\/$/, "").split("/");
      for (let index = 1; index < segments.length; index += 1) {
        const parent = byPath.get(segments.slice(0, index).join("/"));
        if (parent && !parent.isDirectory) {
          fail(
            "PATH_COLLISION",
            `ZIP file is also used as a directory: ${parent.path}`
          );
        }
      }
    }
  }

  function attachLocalDataRanges(bytes, view, records, centralOffset) {
    const ranges = [];

    for (const record of records) {
      const offset = record.localHeaderOffset;
      assertRange(offset, 30, centralOffset);
      if (readUint32(view, offset) !== SIGNATURES.LOCAL_FILE) {
        fail("INVALID_ZIP", `ZIP local header is missing: ${record.path}`);
      }

      const versionNeeded = readUint16(view, offset + 4);
      const flags = readUint16(view, offset + 6);
      const method = readUint16(view, offset + 8);
      const localCrc32 = readUint32(view, offset + 14);
      const localCompressedSize = readUint32(view, offset + 18);
      const localUncompressedSize = readUint32(view, offset + 22);
      const nameLength = readUint16(view, offset + 26);
      const extraLength = readUint16(view, offset + 28);
      const nameStart = offset + 30;
      const extraStart = checkedAdd(nameStart, nameLength, centralOffset);
      const dataStart = checkedAdd(extraStart, extraLength, centralOffset);
      const dataEnd = checkedAdd(dataStart, record.compressedSize, centralOffset);

      if (versionNeeded >= 45) {
        fail("ZIP64_NOT_ALLOWED", "ZIP64 local headers are not supported.");
      }
      if (flags !== record.flags || method !== record.method) {
        fail("INVALID_ZIP", `ZIP headers disagree for entry: ${record.path}`);
      }

      const localNameBytes = bytes.subarray(nameStart, nameStart + nameLength);
      if (!equalBytes(localNameBytes, record.centralNameBytes)) {
        fail("INVALID_ZIP", `ZIP headers contain different paths: ${record.path}`);
      }
      parseExtraFields(bytes, extraStart, extraLength);

      const usesDataDescriptor = Boolean(flags & 0x0008);
      if (!usesDataDescriptor) {
        if (
          localCrc32 !== record.crc32 ||
          localCompressedSize !== record.compressedSize ||
          localUncompressedSize !== record.uncompressedSize
        ) {
          fail("INVALID_ZIP", `ZIP headers contain inconsistent metadata: ${record.path}`);
        }
      } else if (
        (localCrc32 !== 0 && localCrc32 !== record.crc32) ||
        (localCompressedSize !== 0 && localCompressedSize !== record.compressedSize) ||
        (localUncompressedSize !== 0 && localUncompressedSize !== record.uncompressedSize)
      ) {
        fail("INVALID_ZIP", `ZIP data-descriptor metadata is inconsistent: ${record.path}`);
      }

      record.dataStart = dataStart;
      record.dataEnd = dataEnd;
      ranges.push({ start: offset, end: dataEnd, path: record.path });
    }

    ranges.sort((left, right) => left.start - right.start);
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index].start < ranges[index - 1].end) {
        fail(
          "OVERLAPPING_ENTRIES",
          `ZIP entries overlap: ${ranges[index - 1].path} and ${ranges[index].path}`
        );
      }
    }
  }

  async function extractRecord(archiveBytes, record) {
    const compressed = archiveBytes.subarray(record.dataStart, record.dataEnd);
    let extracted;

    if (record.method === METHODS.STORED) {
      extracted = compressed.slice();
    } else {
      extracted = await inflateRaw(compressed, record.uncompressedSize, record.path);
    }

    if (extracted.byteLength !== record.uncompressedSize) {
      fail("SIZE_MISMATCH", `ZIP entry expanded to an unexpected size: ${record.path}`);
    }
    if (crc32(extracted) !== record.crc32) {
      fail("CRC_MISMATCH", `ZIP entry failed its CRC-32 check: ${record.path}`);
    }
    return extracted;
  }

  async function inflateRaw(compressed, expectedSize, path) {
    if (
      typeof DecompressionStream !== "function" ||
      typeof ReadableStream !== "function"
    ) {
      fail(
        "DEFLATE_UNAVAILABLE",
        "This browser cannot extract deflated ZIP entries."
      );
    }

    let reader;
    try {
      const source = new ReadableStream({
        start(controller) {
          controller.enqueue(compressed);
          controller.close();
        },
      });
      reader = source
        .pipeThrough(new DecompressionStream("deflate-raw"))
        .getReader();

      const chunks = [];
      let total = 0;
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = result.value instanceof Uint8Array
          ? result.value
          : new Uint8Array(result.value);
        total += chunk.byteLength;
        if (total > expectedSize) {
          await reader.cancel();
          fail("SIZE_MISMATCH", `ZIP entry expands beyond its declared size: ${path}`);
        }
        chunks.push(chunk);
      }

      const output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return output;
    } catch (error) {
      if (error instanceof MiniProjectArchiveError) throw error;
      fail("INVALID_DEFLATE", `ZIP entry has an invalid deflate stream: ${path}`);
    } finally {
      if (reader) reader.releaseLock();
    }
  }

  function buildMiniProjectDefinition(extractedFiles, limits) {
    if (!extractedFiles.length) {
      fail("INVALID_PROJECT", "ZIP archive does not contain project files.");
    }

    const root = findSharedRoot(extractedFiles.map((file) => file.path));
    const classified = {
      source: [],
      guide: [],
      aiSpec: [],
      assets: [],
      unsupported: [],
    };

    for (const file of extractedFiles) {
      const relativePath = stripSharedRoot(file.path, root);
      const lowerPath = relativePath.toLowerCase();
      const baseName = basename(relativePath);

      if (/\.c$/i.test(baseName)) {
        classified.source.push({ ...file, relativePath, baseName });
      } else if (/_help[^/]*\.md$/i.test(baseName)) {
        classified.guide.push({ ...file, relativePath, baseName });
      } else if (/_ai[^/]*\.md$/i.test(baseName)) {
        classified.aiSpec.push({ ...file, relativePath, baseName });
      } else {
        const extension = extensionOf(lowerPath);
        if (Object.prototype.hasOwnProperty.call(IMAGE_EXTENSIONS, extension)) {
          classified.assets.push({ ...file, relativePath, baseName, extension });
        } else {
          classified.unsupported.push(relativePath);
        }
      }
    }

    if (classified.unsupported.length) {
      fail(
        "UNSUPPORTED_PROJECT_FILE",
        `Unsupported file in mini-project archive: ${classified.unsupported[0]}`
      );
    }
    requireExactlyOne(classified.source, ".c source");
    if (!classified.guide.length) {
      fail(
        "INVALID_PROJECT",
        "Mini-project archive must contain at least one _help Markdown file."
      );
    }
    requireExactlyOne(classified.aiSpec, "_AI Markdown");

    const sourceEntry = classified.source[0];
    const guideEntries = classified.guide;
    const aiEntry = classified.aiSpec[0];
    for (const entry of [sourceEntry, ...guideEntries, aiEntry]) {
      if (entry.baseName.length > 96) {
        fail(
          "INVALID_PROJECT",
          `Core mini-project file name is longer than 96 characters: ${entry.baseName}`
        );
      }
    }
    const coreDirectories = new Set(
      [sourceEntry, ...guideEntries, aiEntry].map((entry) =>
        canonicalPathKey(dirname(entry.relativePath))
      )
    );
    if (coreDirectories.size !== 1) {
      fail("INVALID_PROJECT", "The three core mini-project files must share one folder.");
    }

    const sourceText = decodeProjectText(sourceEntry, limits);
    const decodedGuides = guideEntries.map((entry) => ({
      entry,
      content: decodeProjectText(entry, limits),
      locale: extractGuideLocale(entry.baseName),
    }));
    const aiText = decodeProjectText(aiEntry, limits);
    const sourceLogicalName = logicalProjectName(sourceEntry.baseName, "source");
    const guideLogicalNames = guideEntries.map((entry) =>
      logicalProjectName(entry.baseName, "guide")
    );
    const aiLogicalName = logicalProjectName(aiEntry.baseName, "aiSpec");
    const logicalNames = [
      sourceLogicalName,
      ...guideLogicalNames,
      aiLogicalName,
    ].map(canonicalTextKey);

    if (new Set(logicalNames).size !== 1) {
      fail(
        "MISMATCHED_PROJECT_FILES",
        "The .c, _help.md, and _AI.md files do not share one logical project name."
      );
    }

    const guideLocales = new Set();
    for (const guide of decodedGuides) {
      const key = guide.locale.toLowerCase();
      if (guideLocales.has(key)) {
        fail(
          "INVALID_PROJECT",
          `Mini-project archive has duplicate guide locale: ${guide.locale}.`
        );
      }
      guideLocales.add(key);
    }

    const assets = classified.assets
      .map((entry) => buildImageAsset(entry, limits))
      .sort((left, right) => left.path.localeCompare(right.path));
    const version = extractProjectVersion(sourceText);
    const defaultLocale = guideLocales.has("en")
      ? "en"
      : decodedGuides[0].locale;
    const defaultGuide =
      decodedGuides.find((guide) => guide.locale === defaultLocale) ||
      decodedGuides[0];
    const summary = miniProjectCore.extractShortProjectDescription(
      defaultGuide.content
    );
    if (!summary) {
      fail(
        "INVALID_PROJECT",
        `Guide ${defaultGuide.entry.baseName} is missing a non-empty ## Short Project Description section.`
      );
    }
    const guideFiles = decodedGuides.map((guide) => ({
      role: "guide",
      name: guide.entry.baseName,
      content: guide.content,
      mediaType: "text/markdown",
      locale: guide.locale,
      label: getLocaleLabel(guide.locale),
      default: guide.locale === defaultLocale,
    }));

    return {
      schemaVersion: 1,
      id: sourceLogicalName,
      title: sourceLogicalName,
      summary,
      version,
      defaultLocale,
      files: {
        source: {
          role: "source",
          name: sourceEntry.baseName,
          content: sourceText,
          mediaType: "text/x-c",
        },
        guide: guideFiles.length === 1 ? guideFiles[0] : guideFiles,
        aiSpec: {
          role: "aiSpec",
          name: aiEntry.baseName,
          content: aiText,
          mediaType: "text/markdown",
        },
      },
      assets,
    };
  }

  function decodeProjectText(entry, limits) {
    if (entry.data.byteLength > limits.maxTextBytes) {
      fail("TEXT_TOO_LARGE", `Text file exceeds the size limit: ${entry.relativePath}`);
    }
    if (entry.data.includes(0)) {
      fail("INVALID_TEXT", `Text file contains NUL bytes: ${entry.relativePath}`);
    }

    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(entry.data);
    } catch {
      fail("INVALID_TEXT", `Text file is not valid UTF-8: ${entry.relativePath}`);
    }
    return text.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
  }

  function buildImageAsset(entry, limits) {
    if (entry.data.byteLength > limits.maxImageBytes) {
      fail("IMAGE_TOO_LARGE", `Image exceeds the size limit: ${entry.relativePath}`);
    }

    const expectedMediaType = IMAGE_EXTENSIONS[entry.extension];
    const actualMediaType = detectImageMediaType(entry.data);
    if (!actualMediaType || actualMediaType !== expectedMediaType) {
      fail(
        "INVALID_IMAGE",
        `Image contents do not match its extension: ${entry.relativePath}`
      );
    }

    return {
      name: entry.baseName,
      path: entry.relativePath,
      mediaType: actualMediaType,
      byteLength: entry.data.byteLength,
      crc32: entry.crc32.toString(16).padStart(8, "0"),
      dataUrl: `data:${actualMediaType};base64,${bytesToBase64(entry.data)}`,
    };
  }

  function detectImageMediaType(bytes) {
    if (
      bytes.byteLength >= 24 &&
      equalAt(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0) &&
      readBigEndianUint32(bytes, 8) === 13 &&
      equalAt(bytes, [0x49, 0x48, 0x44, 0x52], 12)
    ) {
      return "image/png";
    }
    if (
      bytes.byteLength >= 4 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff &&
      bytes[bytes.byteLength - 2] === 0xff &&
      bytes[bytes.byteLength - 1] === 0xd9
    ) {
      return "image/jpeg";
    }
    if (
      bytes.byteLength >= 13 &&
      (asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a"))
    ) {
      return "image/gif";
    }
    if (
      bytes.byteLength >= 16 &&
      asciiAt(bytes, 0, "RIFF") &&
      asciiAt(bytes, 8, "WEBP") &&
      readLittleEndianUint32(bytes, 4) + 8 === bytes.byteLength
    ) {
      return "image/webp";
    }
    return null;
  }

  function rejectNestedArchiveName(path) {
    if (/\.(?:7z|bz2|cab|gz|rar|tar|tgz|txz|xz|zip|zipx)$/i.test(path)) {
      fail("NESTED_ARCHIVE", `Nested archives are not allowed: ${path}`);
    }
  }

  function rejectNestedArchiveMagic(bytes, path) {
    const isZip =
      bytes.byteLength >= 4 &&
      (readLittleEndianUint32(bytes, 0) === SIGNATURES.LOCAL_FILE ||
        readLittleEndianUint32(bytes, 0) === SIGNATURES.END_OF_CENTRAL_DIRECTORY ||
        readLittleEndianUint32(bytes, 0) === SIGNATURES.ZIP64_END_OF_CENTRAL_DIRECTORY);
    const isGzip = equalAt(bytes, [0x1f, 0x8b], 0);
    const isBzip = asciiAt(bytes, 0, "BZh");
    const isXz = equalAt(bytes, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], 0);
    const isSevenZip = equalAt(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], 0);
    const isRar =
      equalAt(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00], 0) ||
      equalAt(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00], 0);
    const isTar = bytes.byteLength >= 265 && asciiAt(bytes, 257, "ustar");

    if (isZip || isGzip || isBzip || isXz || isSevenZip || isRar || isTar) {
      fail("NESTED_ARCHIVE", `Nested archive data is not allowed: ${path}`);
    }
  }

  function findSharedRoot(paths) {
    const splitPaths = paths.map((path) => path.split("/"));
    if (
      splitPaths.every((segments) => segments.length >= 2) &&
      splitPaths.every(
        (segments) =>
          canonicalTextKey(segments[0]) === canonicalTextKey(splitPaths[0][0])
      )
    ) {
      return splitPaths[0][0];
    }
    return "";
  }

  function stripSharedRoot(path, root) {
    if (!root) return path;
    return path.slice(root.length + 1);
  }

  function logicalProjectName(fileName, role) {
    let stem = fileName.replace(/\.[^.]+$/, "").replace(/\(\d+\)$/, "");
    stem = stem.replace(/[_-]\d+\.\d+\.\d+(?:-[a-z0-9]+)?$/i, "");
    if (role === "guide") {
      stem = stem.replace(/_help(?:\([^)]+\))?(?:[._-].*)?$/i, "");
    }
    if (role === "aiSpec") stem = stem.replace(/_ai(?:[._-].*)?$/i, "");
    stem = stem.trim();
    if (!stem) fail("INVALID_PROJECT", `Cannot determine project name from ${fileName}.`);
    return stem;
  }

  function extractGuideLocale(fileName) {
    const match = /_help\(([A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*)\)/i.exec(
      fileName
    );
    if (!match) return "en";
    const locale = match[1].replace(/_/g, "-");
    if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(locale)) {
      fail("INVALID_PROJECT", `Invalid guide locale in file name: ${fileName}.`);
    }
    return locale
      .split("-")
      .map((part, index) =>
        index === 0
          ? part.toLowerCase()
          : part.length === 2
            ? part.toUpperCase()
            : part
      )
      .join("-");
  }

  function getLocaleLabel(locale) {
    const labels = { en: "English", es: "Español", ru: "Русский" };
    return labels[locale.toLowerCase()] || locale;
  }

  function extractProjectVersion(sourceText) {
    const match = /\b(?:Revision|Variant|Version)\s+(\d+\.\d+\.\d+(?:-[a-z0-9]+)?)/i.exec(
      sourceText
    );
    return match ? match[1] : 1;
  }

  function requireExactlyOne(entries, label) {
    if (entries.length !== 1) {
      fail(
        "INVALID_PROJECT",
        `Mini-project archive must contain exactly one ${label} file; found ${entries.length}.`
      );
    }
  }

  function resolveLimits(overrides) {
    if (overrides !== undefined && (!overrides || typeof overrides !== "object")) {
      throw new TypeError("Archive limits must be an object.");
    }

    const limits = {};
    for (const name of LIMIT_NAMES) {
      const value =
        overrides && Object.prototype.hasOwnProperty.call(overrides, name)
          ? overrides[name]
          : DEFAULT_LIMITS[name];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new TypeError(`Archive limit ${name} must be a positive number.`);
      }
      if (name !== "maxCompressionRatio" && !Number.isSafeInteger(value)) {
        throw new TypeError(`Archive limit ${name} must be a positive integer.`);
      }
      limits[name] = value;
    }
    return limits;
  }

  async function toUint8Array(input) {
    if (input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer !== "undefined" && input instanceof ArrayBuffer) {
      return new Uint8Array(input);
    }
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    if (input && typeof input.arrayBuffer === "function") {
      return new Uint8Array(await input.arrayBuffer());
    }
    throw new TypeError("ZIP input must be a Blob, ArrayBuffer, or Uint8Array.");
  }

  function decodeEntryName(bytes, isUtf8) {
    if (!isUtf8) {
      for (const byte of bytes) {
        if (byte > 0x7f) {
          fail(
            "UNSUPPORTED_FILENAME_ENCODING",
            "Legacy non-ASCII ZIP file names are not supported."
          );
        }
      }
      return String.fromCharCode(...bytes);
    }

    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail("INVALID_PATH", "ZIP entry name is not valid UTF-8.");
    }
  }

  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
    }
    return (value ^ 0xffffffff) >>> 0;
  }

  function createCrcTable() {
    const table = new Uint32Array(256);
    for (let index = 0; index < table.length; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    return table;
  }

  function bytesToBase64(bytes) {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const parts = [];
    let chunk = "";

    for (let index = 0; index < bytes.length; index += 3) {
      const first = bytes[index];
      const hasSecond = index + 1 < bytes.length;
      const hasThird = index + 2 < bytes.length;
      const second = hasSecond ? bytes[index + 1] : 0;
      const third = hasThird ? bytes[index + 2] : 0;
      const value = (first << 16) | (second << 8) | third;

      chunk += alphabet[(value >>> 18) & 63];
      chunk += alphabet[(value >>> 12) & 63];
      chunk += hasSecond ? alphabet[(value >>> 6) & 63] : "=";
      chunk += hasThird ? alphabet[value & 63] : "=";
      if (chunk.length >= 8192) {
        parts.push(chunk);
        chunk = "";
      }
    }
    if (chunk) parts.push(chunk);
    return parts.join("");
  }

  function basename(path) {
    const index = path.lastIndexOf("/");
    return index === -1 ? path : path.slice(index + 1);
  }

  function dirname(path) {
    const index = path.lastIndexOf("/");
    return index === -1 ? "" : path.slice(0, index);
  }

  function extensionOf(path) {
    const fileName = basename(path);
    const index = fileName.lastIndexOf(".");
    return index <= 0 ? "" : fileName.slice(index).toLowerCase();
  }

  function canonicalPathKey(path) {
    return canonicalTextKey(path);
  }

  function canonicalTextKey(value) {
    let normalized = String(value);
    if (typeof normalized.normalize === "function") normalized = normalized.normalize("NFC");
    return normalized.toLowerCase();
  }

  function checkedAdd(left, right, upperBound) {
    const result = left + right;
    if (!Number.isSafeInteger(result) || result < left || result > upperBound) {
      fail("INVALID_ZIP", "ZIP record points outside the archive.");
    }
    return result;
  }

  function assertRange(offset, length, upperBound) {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > upperBound
    ) {
      fail("INVALID_ZIP", "ZIP record is truncated or out of bounds.");
    }
  }

  function dataViewFor(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function readUint16(view, offset) {
    assertRange(offset, 2, view.byteLength);
    return view.getUint16(offset, true);
  }

  function readUint32(view, offset) {
    assertRange(offset, 4, view.byteLength);
    return view.getUint32(offset, true);
  }

  function readLittleEndianUint32(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.byteLength) return -1;
    return (
      bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)
    ) >>> 0;
  }

  function readBigEndianUint32(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.byteLength) return -1;
    return (
      ((bytes[offset] << 24) >>> 0) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]
    ) >>> 0;
  }

  function equalBytes(left, right) {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  function equalAt(bytes, expected, offset) {
    if (offset < 0 || offset + expected.length > bytes.byteLength) return false;
    for (let index = 0; index < expected.length; index += 1) {
      if (bytes[offset + index] !== expected[index]) return false;
    }
    return true;
  }

  function asciiAt(bytes, offset, expected) {
    if (offset < 0 || offset + expected.length > bytes.byteLength) return false;
    for (let index = 0; index < expected.length; index += 1) {
      if (bytes[offset + index] !== expected.charCodeAt(index)) return false;
    }
    return true;
  }

  function fail(code, message) {
    throw new MiniProjectArchiveError(code, message);
  }

  return Object.freeze({
    DEFAULT_LIMITS,
    MiniProjectArchiveError,
    parseMiniProjectArchive,
  });
});
