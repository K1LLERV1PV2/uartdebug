(function (root, factory) {
  "use strict";

  const core = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = core;
  }

  if (root) {
    root.UartDebugAvrMiniProjectCore = core;
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const SCHEMA_VERSION = 1;
  const ROLES = Object.freeze({
    SOURCE: "source",
    GUIDE: "guide",
    AI_SPEC: "aiSpec",
  });
  const CANONICAL_ROLES = Object.freeze([
    ROLES.SOURCE,
    ROLES.GUIDE,
    ROLES.AI_SPEC,
  ]);

  const ROLE_ALIASES = Object.freeze({
    source: ROLES.SOURCE,
    src: ROLES.SOURCE,
    code: ROLES.SOURCE,
    c: ROLES.SOURCE,
    csource: ROLES.SOURCE,
    program: ROLES.SOURCE,
    firmware: ROLES.SOURCE,

    guide: ROLES.GUIDE,
    doc: ROLES.GUIDE,
    docs: ROLES.GUIDE,
    documentation: ROLES.GUIDE,
    human: ROLES.GUIDE,
    explanation: ROLES.GUIDE,
    readme: ROLES.GUIDE,

    aispec: ROLES.AI_SPEC,
    ai: ROLES.AI_SPEC,
    agent: ROLES.AI_SPEC,
    api: ROLES.AI_SPEC,
    yaml: ROLES.AI_SPEC,
    metadata: ROLES.AI_SPEC,
    machine: ROLES.AI_SPEC,
    prompt: ROLES.AI_SPEC,
    spec: ROLES.AI_SPEC,
  });

  const DEFAULT_MEDIA_TYPES = Object.freeze({
    [ROLES.SOURCE]: "text/x-c",
    [ROLES.GUIDE]: "text/markdown",
    [ROLES.AI_SPEC]: "text/markdown",
  });

  function normalizeRole(value) {
    if (typeof value !== "string") return null;

    const key = value
      .trim()
      .toLowerCase()
      .replace(/[\s_.-]+/g, "");

    return Object.prototype.hasOwnProperty.call(ROLE_ALIASES, key)
      ? ROLE_ALIASES[key]
      : null;
  }

  function inferFileRole(fileOrName, explicitRole) {
    let name = fileOrName;
    let role = explicitRole;

    if (fileOrName && typeof fileOrName === "object") {
      name = fileOrName.name;
      role = fileOrName.role;
    } else if (
      arguments.length > 1 &&
      normalizeRole(fileOrName) &&
      typeof explicitRole === "string" &&
      /\.[^.]+$/i.test(explicitRole)
    ) {
      name = explicitRole;
      role = fileOrName;
    }

    const normalizedExplicitRole = normalizeRole(role);
    if (normalizedExplicitRole) return normalizedExplicitRole;
    if (typeof name !== "string") return null;

    const normalizedName = name.trim().toLowerCase();
    if (/\.c$/i.test(normalizedName)) return ROLES.SOURCE;
    if (
      /_ai[^/\\]*\.md$/i.test(normalizedName) ||
      /\.(?:ai|agent|ya?ml|api)\.md$/i.test(normalizedName) ||
      /\.(?:ai|agent|ya?ml|api)$/i.test(normalizedName)
    ) {
      return ROLES.AI_SPEC;
    }
    if (/_help[^/\\]*\.md$/i.test(normalizedName)) return ROLES.GUIDE;
    if (/\.md$/i.test(normalizedName)) return ROLES.GUIDE;

    return null;
  }

  function normalizeDefinition(definition) {
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      throw new TypeError("Mini-project definition must be an object.");
    }

    if (
      definition.schemaVersion !== undefined &&
      Number(definition.schemaVersion) !== SCHEMA_VERSION
    ) {
      throw new Error(
        `Unsupported mini-project schema version: ${definition.schemaVersion}.`
      );
    }

    const id = normalizeRequiredText(definition.id, "Mini-project id");
    const title =
      definition.title === undefined
        ? id
        : normalizeRequiredText(definition.title, "Mini-project title");
    const summary = normalizeOptionalText(
      definition.summary,
      "Mini-project summary"
    );
    const version = normalizeVersion(definition.version);
    const rawFiles = collectDefinitionFiles(definition);
    const filesByRole = {};
    const guides = [];
    const guideLocales = new Set();
    const usedNames = new Set();

    for (let index = 0; index < rawFiles.length; index += 1) {
      const entry = rawFiles[index];
      const file = normalizeFile(entry.file, entry.roleHint, index);
      const nameKey = file.name.toLocaleLowerCase();

      if (usedNames.has(nameKey)) {
        throw new Error(`Duplicate mini-project file name: ${file.name}.`);
      }
      usedNames.add(nameKey);

      if (file.role === ROLES.GUIDE) {
        if (file.locale) {
          const localeKey = file.locale.toLowerCase();
          if (guideLocales.has(localeKey)) {
            throw new Error(
              `Mini-project definition has duplicate guide locale: ${file.locale}.`
            );
          }
          guideLocales.add(localeKey);
        }
        guides.push(file);
        continue;
      }

      if (filesByRole[file.role]) {
        if (file.role === ROLES.SOURCE) {
          throw new Error("Mini-project definition has duplicate source files.");
        }
        throw new Error(`Mini-project definition has duplicate ${file.role} files.`);
      }

      filesByRole[file.role] = file;
    }

    if (!filesByRole[ROLES.SOURCE]) {
      throw new Error("Mini-project definition is missing a source file.");
    }

    const guideSelection = selectDefaultGuide(
      guides,
      definition.defaultLocale
    );
    const files = { source: filesByRole[ROLES.SOURCE] };
    if (guideSelection.guide) files.guide = guideSelection.guide;
    if (filesByRole[ROLES.AI_SPEC]) {
      files.aiSpec = filesByRole[ROLES.AI_SPEC];
    }

    const normalized = {
      schemaVersion: SCHEMA_VERSION,
      id,
      title,
      summary,
      version,
      files,
      guides,
      defaultLocale: guideSelection.defaultLocale,
    };

    if (Object.prototype.hasOwnProperty.call(definition, "assets")) {
      if (!Array.isArray(definition.assets) && !isPlainObject(definition.assets)) {
        throw new TypeError(
          "Mini-project assets metadata must be an array or object."
        );
      }
      normalized.assets = cloneSafeMetadata(
        definition.assets,
        "Mini-project assets"
      );
    }

    if (Object.prototype.hasOwnProperty.call(definition, "aiSpecRef")) {
      if (!isPlainObject(definition.aiSpecRef)) {
        throw new TypeError("Mini-project aiSpecRef metadata must be an object.");
      }
      normalized.aiSpecRef = cloneSafeMetadata(
        definition.aiSpecRef,
        "Mini-project aiSpecRef"
      );
    }

    return normalized;
  }

  function collectDefinitionFiles(definition) {
    const collected = [];

    if (Array.isArray(definition.files)) {
      collected.push(
        ...definition.files.map((file) => ({ file, roleHint: null }))
      );
    } else if (
      definition.files &&
      typeof definition.files === "object" &&
      !Array.isArray(definition.files)
    ) {
      for (const [roleName, file] of Object.entries(definition.files)) {
        const roleHint = normalizeRole(roleName);
        if (!roleHint) {
          throw new Error(`Unknown mini-project file role: ${roleName}.`);
        }
        if (roleHint === ROLES.GUIDE && Array.isArray(file)) {
          collected.push(
            ...file.map((guide) => ({ file: guide, roleHint: ROLES.GUIDE }))
          );
        } else {
          collected.push({ file, roleHint });
        }
      }
    } else if (
      Object.prototype.hasOwnProperty.call(definition, "fileName") ||
      Object.prototype.hasOwnProperty.call(definition, "content")
    ) {
      collected.push({
        roleHint: ROLES.SOURCE,
        file: {
          role: ROLES.SOURCE,
          name: definition.fileName,
          content: definition.content,
          mediaType: definition.mediaType,
        },
      });
    }

    if (Object.prototype.hasOwnProperty.call(definition, "guides")) {
      if (!Array.isArray(definition.guides)) {
        throw new TypeError("Mini-project guides must be an array.");
      }
      collected.push(
        ...definition.guides.map((guide) => ({
          file: guide,
          roleHint: ROLES.GUIDE,
        }))
      );
    }

    return collected;
  }

  function normalizeFile(rawFile, roleHint, index) {
    if (!rawFile || typeof rawFile !== "object" || Array.isArray(rawFile)) {
      throw new TypeError(`Mini-project file ${index + 1} must be an object.`);
    }

    let explicitRole = null;
    if (rawFile.role !== undefined && rawFile.role !== null) {
      explicitRole = normalizeRole(rawFile.role);
      if (!explicitRole) {
        throw new Error(`Unknown mini-project file role: ${rawFile.role}.`);
      }
    }

    if (roleHint && explicitRole && roleHint !== explicitRole) {
      throw new Error(
        `Mini-project file role conflicts with its "${roleHint}" key.`
      );
    }

    const name = normalizeFileName(rawFile.name);
    const role = roleHint || explicitRole || inferFileRole(name);
    if (!role) {
      throw new Error(`Cannot infer a role for mini-project file: ${name}.`);
    }
    if (role === ROLES.SOURCE && !/\.c$/i.test(name)) {
      throw new Error(`Mini-project source file must use the .c extension: ${name}.`);
    }
    if (
      (role === ROLES.GUIDE || role === ROLES.AI_SPEC) &&
      !/\.md$/i.test(name)
    ) {
      throw new Error(
        `Mini-project ${role} file must use the .md extension: ${name}.`
      );
    }

    if (typeof rawFile.content !== "string") {
      throw new TypeError(
        `Mini-project file content must be a string: ${name}.`
      );
    }

    let mediaType = DEFAULT_MEDIA_TYPES[role];
    if (rawFile.mediaType !== undefined && rawFile.mediaType !== null) {
      if (typeof rawFile.mediaType !== "string" || !rawFile.mediaType.trim()) {
        throw new TypeError(
          `Mini-project file mediaType must be a non-empty string: ${name}.`
        );
      }
      mediaType = rawFile.mediaType.trim();
    }

    const file = {
      role,
      name,
      content: rawFile.content.replace(/\r\n?/g, "\n"),
      mediaType,
    };

    if (rawFile.locale !== undefined && rawFile.locale !== null) {
      if (role !== ROLES.GUIDE) {
        throw new Error(
          `Mini-project locale metadata is only valid for guide files: ${name}.`
        );
      }
      file.locale = normalizeLocale(rawFile.locale, `Guide locale for ${name}`);
    }

    if (rawFile.label !== undefined && rawFile.label !== null) {
      if (role !== ROLES.GUIDE) {
        throw new Error(
          `Mini-project label metadata is only valid for guide files: ${name}.`
        );
      }
      file.label = normalizeRequiredText(rawFile.label, `Guide label for ${name}`);
    }

    if (rawFile.default !== undefined) {
      if (role !== ROLES.GUIDE || typeof rawFile.default !== "boolean") {
        throw new TypeError(
          `Mini-project guide default metadata must be a boolean: ${name}.`
        );
      }
      file.default = rawFile.default;
    }

    if (rawFile.assetBaseUrl !== undefined && rawFile.assetBaseUrl !== null) {
      if (role !== ROLES.GUIDE) {
        throw new Error(
          `Mini-project assetBaseUrl is only valid for guide files: ${name}.`
        );
      }
      file.assetBaseUrl = normalizeRequiredText(
        rawFile.assetBaseUrl,
        `Guide assetBaseUrl for ${name}`
      );
    }

    if (Object.prototype.hasOwnProperty.call(rawFile, "assets")) {
      if (!Array.isArray(rawFile.assets) && !isPlainObject(rawFile.assets)) {
        throw new TypeError(
          `Mini-project file assets must be an array or object: ${name}.`
        );
      }
      file.assets = cloneSafeMetadata(rawFile.assets, `Assets for ${name}`);
    }

    return file;
  }

  function normalizeFileName(value) {
    if (typeof value !== "string") {
      throw new TypeError("Mini-project file name must be a string.");
    }

    const name = value.trim();
    if (!name || name === "." || name === "..") {
      throw new Error("Mini-project file name is invalid.");
    }
    if (name.length > 96) {
      throw new Error("Mini-project file name must be 96 characters or fewer.");
    }
    if (/[\\/:*?"<>|\x00-\x1f]/.test(name)) {
      throw new Error(`Mini-project file name is invalid: ${name}.`);
    }

    return name;
  }

  function normalizeRequiredText(value, label) {
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`${label} must be a non-empty string.`);
    }
    return value.trim();
  }

  function normalizeOptionalText(value, label) {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") {
      throw new TypeError(`${label} must be a string.`);
    }
    return value.trim();
  }

  function normalizeVersion(value) {
    if (value === undefined || value === null) return 1;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === "string" && value.trim()) return value.trim();
    throw new TypeError("Mini-project version must be a positive number or string.");
  }

  function selectDefaultGuide(guides, rawDefaultLocale) {
    const explicitlyDefault = guides.filter((guide) => guide.default === true);
    if (explicitlyDefault.length > 1) {
      throw new Error("Mini-project definition has multiple default guides.");
    }

    let defaultLocale = "";
    if (rawDefaultLocale !== undefined && rawDefaultLocale !== null) {
      defaultLocale = normalizeLocale(
        rawDefaultLocale,
        "Mini-project defaultLocale"
      );
    }

    let guide = null;
    if (defaultLocale) {
      guide =
        guides.find(
          (candidate) =>
            candidate.locale &&
            candidate.locale.toLowerCase() === defaultLocale.toLowerCase()
        ) || null;

      if (!guide && guides.length === 1 && !guides[0].locale) {
        guides[0].locale = defaultLocale;
        guide = guides[0];
      }

      if (!guide && guides.length > 0) {
        throw new Error(
          `Mini-project defaultLocale has no matching guide: ${defaultLocale}.`
        );
      }
    } else {
      guide = explicitlyDefault[0] || guides[0] || null;
      defaultLocale = guide && guide.locale ? guide.locale : "";
    }

    if (
      explicitlyDefault[0] &&
      guide &&
      explicitlyDefault[0] !== guide
    ) {
      throw new Error(
        "Mini-project defaultLocale conflicts with the default guide."
      );
    }

    return { guide, defaultLocale };
  }

  function normalizeLocale(value, label) {
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`${label} must be a non-empty string.`);
    }

    const locale = value.trim().replace(/_/g, "-");
    if (
      locale.length > 48 ||
      !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(locale)
    ) {
      throw new Error(`${label} is invalid: ${value}.`);
    }

    return locale
      .split("-")
      .map((part, index) => {
        if (index === 0) return part.toLowerCase();
        if (/^[a-z]{4}$/i.test(part)) {
          return part[0].toUpperCase() + part.slice(1).toLowerCase();
        }
        if (/^[a-z]{2}$/i.test(part)) return part.toUpperCase();
        return part.toLowerCase();
      })
      .join("-");
  }

  function cloneSafeMetadata(value, label, depth = 0) {
    if (depth > 12) {
      throw new Error(`${label} metadata is nested too deeply.`);
    }

    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new TypeError(`${label} metadata contains a non-finite number.`);
      }
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => cloneSafeMetadata(entry, label, depth + 1));
    }

    if (!isPlainObject(value)) {
      throw new TypeError(`${label} metadata must contain only JSON-safe values.`);
    }

    const clone = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new Error(`${label} metadata contains an unsafe key: ${key}.`);
      }
      clone[key] = cloneSafeMetadata(entry, label, depth + 1);
    }
    return clone;
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function parseDocumentationMarker(line) {
    if (typeof line !== "string") return null;

    const { start } = scanDocumentationLine(line, false);
    return createDocumentationMarker(line, start);
  }

  function createDocumentationMarkerScanner() {
    let inBlockComment = false;

    return Object.freeze({
      parseLine(line) {
        if (typeof line !== "string") return null;
        const result = scanDocumentationLine(line, inBlockComment);
        inBlockComment = result.inBlockComment;
        return createDocumentationMarker(line, result.start);
      },
      reset() {
        inBlockComment = false;
      },
    });
  }

  function createDocumentationMarker(line, start) {
    if (start < 0) return null;

    const match = /^\/\/(#{1,6})[ \t]+(.+?)\s*$/.exec(line.slice(start));
    if (!match) return null;

    const title = match[2].trim();
    if (!title) return null;

    return {
      level: match[1].length,
      title,
      key: normalizeHeadingKey(title),
      start,
      end: line.length,
    };
  }

  function scanDocumentationLine(line, startsInBlockComment) {
    let state = startsInBlockComment ? "block" : "code";

    for (let index = 0; index < line.length - 1; index += 1) {
      const character = line[index];
      const next = line[index + 1];

      if (state === "block") {
        if (character === "*" && next === "/") {
          state = "code";
          index += 1;
        }
        continue;
      }

      if (state === "string" || state === "character") {
        if (character === "\\") {
          index += 1;
          continue;
        }
        if (
          (state === "string" && character === '"') ||
          (state === "character" && character === "'")
        ) {
          state = "code";
        }
        continue;
      }

      if (character === '"') {
        state = "string";
        continue;
      }
      if (character === "'") {
        state = "character";
        continue;
      }
      if (character === "/" && next === "*") {
        state = "block";
        index += 1;
        continue;
      }
      if (character === "/" && next === "/") {
        return { start: index, inBlockComment: false };
      }
    }

    return { start: -1, inBlockComment: state === "block" };
  }

  function normalizeHeadingKey(value) {
    if (value === undefined || value === null) return "";

    let text = String(value).trim();
    text = text
      .replace(/^\s{0,3}#{1,6}[ \t]+/, "")
      .replace(/[ \t]+#+[ \t]*$/, "")
      .replace(/[ \t]+\{(?:#[\w-]+|\.[\w-]+)(?:[ \t]+[.#][\w-]+)*\}[ \t]*$/, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      .replace(/`+([^`]*?)`+/g, "$1")
      .replace(/<(?:https?:\/\/|mailto:)([^>]+)>/gi, "$1")
      .replace(/<[^>]*>/g, " ")
      .replace(/\\([\\`*_[\]{}()#+\-.!])/g, "$1")
      .replace(/[*_~]/g, " ");

    text = decodeHtmlEntities(text);
    if (typeof text.normalize === "function") {
      text = text.normalize("NFKD");
    }

    text = text.toLocaleLowerCase().replace(/\p{M}+/gu, "");
    const words = text.match(/[\p{L}\p{N}]+/gu);
    return words ? words.join(" ") : "";
  }

  function decodeHtmlEntities(value) {
    const namedEntities = {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      nbsp: " ",
      quot: '"',
    };

    return value
      .replace(/&#(\d+);/g, (match, digits) =>
        decodeCodePoint(match, Number.parseInt(digits, 10))
      )
      .replace(/&#x([\da-f]+);/gi, (match, digits) =>
        decodeCodePoint(match, Number.parseInt(digits, 16))
      )
      .replace(/&(amp|apos|gt|lt|nbsp|quot);/gi, (match, name) =>
        namedEntities[name.toLowerCase()]
      );
  }

  function decodeCodePoint(fallback, codePoint) {
    try {
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : fallback;
    } catch {
      return fallback;
    }
  }

  function extractMarkdownHeadings(markdown) {
    if (typeof markdown !== "string") return [];

    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const headings = [];
    let activeFence = null;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];

      if (activeFence) {
        if (isClosingFence(line, activeFence)) activeFence = null;
        continue;
      }

      const openingFence = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
      if (openingFence) {
        activeFence = {
          character: openingFence[2][0],
          length: openingFence[2].length,
        };
        continue;
      }

      const atx = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
      if (atx) {
        const title = atx[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
        if (title) {
          headings.push({
            level: atx[1].length,
            title,
            key: normalizeHeadingKey(title),
          });
        }
        continue;
      }

      const setext =
        index + 1 < lines.length
          ? /^ {0,3}(=+|-+)[ \t]*$/.exec(lines[index + 1])
          : null;
      const title = line.trim();
      if (setext && title && !/^ {4}/.test(line)) {
        headings.push({
          level: setext[1][0] === "=" ? 1 : 2,
          title,
          key: normalizeHeadingKey(title),
        });
        index += 1;
      }
    }

    return headings;
  }

  function isClosingFence(line, fence) {
    const escapedCharacter = fence.character === "`" ? "`" : "~";
    const pattern = new RegExp(
      `^ {0,3}${escapedCharacter}{${fence.length},}[ \\t]*$`
    );
    return pattern.test(line);
  }

  function extractShortProjectDescription(markdown) {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const paragraph = [];
    let collecting = false;
    let fence = null;

    for (const line of lines) {
      if (fence) {
        if (isClosingFence(line, fence)) fence = null;
        continue;
      }

      const openingFence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (openingFence) {
        fence = {
          character: openingFence[1][0],
          length: openingFence[1].length,
        };
        continue;
      }

      if (!collecting) {
        if (
          /^ {0,3}##[ \t]+Short Project Description[ \t]*#*[ \t]*$/i.test(
            line
          )
        ) {
          collecting = true;
        }
        continue;
      }

      if (/^ {0,3}#{1,6}[ \t]+/.test(line)) break;
      if (!line.trim()) {
        if (paragraph.length) break;
        continue;
      }
      paragraph.push(line.trim());
    }

    return paragraph.join(" ");
  }

  return Object.freeze({
    SCHEMA_VERSION,
    ROLES,
    CANONICAL_ROLES,
    normalizeRole,
    inferFileRole,
    normalizeDefinition,
    parseDocumentationMarker,
    createDocumentationMarkerScanner,
    normalizeHeadingKey,
    extractMarkdownHeadings,
    extractShortProjectDescription,
  });
});
