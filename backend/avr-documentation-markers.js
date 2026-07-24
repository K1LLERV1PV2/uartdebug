"use strict";

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
    .replace(
      /[ \t]+\{(?:#[\w-]+|\.[\w-]+)(?:[ \t]+[.#][\w-]+)*\}[ \t]*$/,
      ""
    )
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
    return Number.isInteger(codePoint) &&
      codePoint >= 0 &&
      codePoint <= 0x10ffff
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

function extractDocumentationMarkers(source) {
  const scanner = createDocumentationMarkerScanner();
  return String(source || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => {
      const marker = scanner.parseLine(line);
      return marker ? [marker] : [];
    });
}

module.exports = {
  createDocumentationMarkerScanner,
  extractDocumentationMarkers,
  extractMarkdownHeadings,
  normalizeHeadingKey,
};
