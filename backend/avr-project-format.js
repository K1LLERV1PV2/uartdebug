(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.UartDebugAvrProjectFormat = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const bytes = (value) => new TextEncoder().encode(value).length;
  const unique = (values) => [...new Set(values)];

  // Retain line positions while separating requirements from examples and discussion.
  function specificationText(markdown) {
    let fence = null;
    let remark = false;
    let answer = false;
    let temporary = false;
    return String(markdown || "").replace(/^\ufeff/, "").replace(/\r\n?/g, "\n").split("\n").map((line) => {
      if (fence) {
        const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
        if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = null;
        return "";
      }
      const fenceLine = line.replace(/^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/, "");
      const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(fenceLine);
      if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
        fence = opening[1];
        return "";
      }
      if (/^ {0,3}>/.test(line)) {
        if (/^ {0,3}>[ \t]*#{6}[ \t]+\*\[(?:AI|ИИ)\.\d+\]/.test(line)) remark = true;
        return "";
      }
      if (!line.trim()) {
        remark = answer = false;
        return "";
      }
      if (remark || answer) {
        answer = true;
        remark = false;
        return "";
      }
      if (/^(?: {4}|\t)/.test(line)) return "";
      if (/^\s*!\+\s*$/.test(line)) { temporary = true; return ""; }
      if (/^\s*!-\s*$/.test(line)) { temporary = false; return ""; }
      if (temporary) return "";
      if (/^\s*(?:!X(?:\s|$)|![+-]\s*$|!\s)/.test(line)) return "";
      return line.replace(/[ \t]+!X(?:[ \t].*)?$/, "");
    }).join("\n");
  }

  const nameLabel = "(?:Проект|Project|Proyecto|Projet|Projekt|Projeto|Progetto)";
  const versionLabel = "(?:Версия проекта|Project version|Versión del proyecto|Version du projet|Projektversion|Version des Projekts|Versão do projeto|Versione del progetto)";
  const cLabel = "(?:Файл программы C|C program file|C source file|Archivo (?:del programa|fuente) C|Fichier (?:du programme|source) C|C-Programmdatei|C-Quelldatei)";
  const yamlLabel = "(?:Файл ресурсов проекта|Project resources file|Resource file|Archivo de recursos(?: del proyecto)?|Fichier (?:des )?ressources(?: du projet)?|Projektressourcendatei|Ressourcendatei)";
  const metadata = (markdown, label) => [...specificationText(markdown).matchAll(new RegExp(`^${label}[ \\t]*[-:][ \\t]*(.*?)[ \\t]*$`, "gim"))].map((match) => match[1].trim());

  function projectIdentity(markdown) {
    const text = specificationText(markdown);
    const names = [...text.matchAll(new RegExp(`^#[ \\t]+${nameLabel}[ \\t]+(.+?)[ \\t]*$`, "gim"))].map((match) => match[1].trim());
    const versions = metadata(markdown, versionLabel);
    if (!names.length || unique(names).length !== 1 || !versions.length || unique(versions).length !== 1 || !/^Ver\.\d+\.\d+$/i.test(versions[0])) return null;
    return { title: names[0], version: versions[0].replace(/^ver\./i, "Ver.") };
  }

  function safeFilename(name, extension) {
    if (typeof name !== "string" || !name || bytes(name) > 96 || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[ .]$/.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || (extension && !extension.test(name))) throw Error("Project files require safe local filenames with the correct extension.");
    return name;
  }

  function parseProjectFilename(name) {
    if (typeof name !== "string" || /[\\/\x00-\x1f]/.test(name)) return null;
    const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
    if (!extension) return null;
    let stem = name.slice(0, -extension.length - 1);
    const originalStem = stem;
    let copy = 1;
    const duplicate = /\s*\(([0-9]+)\)$/.exec(stem);
    if (duplicate && Number(duplicate[1]) >= 2 && Number.isSafeInteger(Number(duplicate[1]))) {
      copy = Number(duplicate[1]);
      stem = stem.slice(0, duplicate.index);
    }
    let variant = "";
    const variantMatch = /\s+\(([^()]+)\)$/.exec(stem);
    if (variantMatch && variantMatch[1].toLowerCase() !== "description") {
      variant = variantMatch[1];
      stem = stem.slice(0, variantMatch.index);
    }
    let purpose = "";
    const stripPurpose = () => {
      const match = /(?:\s+\(description\)|\.guide|[._]description)$/i.exec(stem);
      if (match) { purpose = "description"; stem = stem.slice(0, match.index); }
    };
    stripPurpose();
    let version = null;
    const versionMatch = /\s+Ver\.(\d+)\.(\d+)\.(\d+)(?:-([a-z]))?$/.exec(stem);
    if (versionMatch) {
      const [major, minor, file] = versionMatch.slice(1, 4).map(Number);
      if (![major, minor, file].every(Number.isSafeInteger) || file < 1) return null;
      version = { major, minor, file, revision: versionMatch[4] || "" };
      stem = stem.slice(0, versionMatch.index);
    } else if (/\s+Ver\./i.test(stem)) return null;
    stripPurpose();
    if (!stem.trim()) return null;
    return { name, stem: originalStem, extension, baseName: stem, version, variant, copy, purpose };
  }

  const projectVersion = (value) => /^Ver\.(\d+)\.(\d+)$/i.exec(String(value || ""))?.slice(1).map(Number) || null;
  function sameProjectVersion(file, version) {
    const selected = projectVersion(version);
    return !file.version || !!selected && file.version.major === selected[0] && file.version.minor === selected[1];
  }
  function alternatives(markdown) {
    const c = metadata(markdown, cLabel);
    const yaml = metadata(markdown, yamlLabel);
    if (!c.length && !yaml.length) return null;
    if (c.length !== 1 || yaml.length !== 1 || !c[0] || !yaml[0]) throw Error("Confirmed alternative output names must be one complete C/YAML pair in the specification.");
    return { sourceName: safeFilename(c[0], /\.c$/i), resourcesName: safeFilename(yaml[0], /\.yaml$/i) };
  }
  function projectOutputNames(markdown, identity, currentProject = null) {
    if (!identity?.title || !projectVersion(identity.version)) throw Error("Specify one project name and Ver.X.Y before selecting output filenames.");
    const confirmed = alternatives(markdown);
    if (confirmed) return confirmed;
    const names = {
      sourceName: currentProject?.source?.trim() ? currentProject.sourceName : `${identity.title}.c`,
      resourcesName: currentProject?.specification?.content?.trim() ? currentProject.specification.name : `${identity.title}.yaml`,
    };
    for (const [key, extension] of [["sourceName", /\.c$/i], ["resourcesName", /\.yaml$/i]]) {
      safeFilename(names[key], extension);
      const parsed = parseProjectFilename(names[key]);
      if (!parsed || parsed.baseName !== identity.title || parsed.purpose || !sameProjectVersion(parsed, identity.version)) throw Error(`The existing output filename ${names[key]} does not match project ${identity.title} ${identity.version}. Confirm one complete alternative C/YAML filename pair in the specification or rename the file explicitly.`);
    }
    return names;
  }

  function rank(parsed) { return [parsed.version?.file || 0, parsed.version?.revision ? parsed.version.revision.charCodeAt(0) - 96 : 0, parsed.copy]; }
  function compare(a, b) {
    const left = rank(a.parsed), right = rank(b.parsed);
    for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return right[index] - left[index];
    return 0;
  }
  function choose(candidates, version, label, variant = "") {
    const variants = candidates.filter((item) => item.parsed.variant === variant);
    if (!variants.length) {
      if (candidates.length && !variant) throw Error(`Choose an explicit language or purpose variant for ${label}; no untagged file exists.`);
      return null;
    }
    const versioned = variants.filter((item) => item.parsed.version && sameProjectVersion(item.parsed, version));
    let eligible = versioned;
    if (!eligible.length) eligible = variants.filter((item) => !item.parsed.version);
    if (!eligible.length) throw Error(`No ${label} matches project version ${version || "(not confirmed)"}. Resolve the project version explicitly.`);
    eligible.sort(compare);
    if (eligible.length > 1 && !compare(eligible[0], eligible[1])) throw Error(`Ambiguous ${label}: multiple files have the same version, revision and copy rank.`);
    return eligible[0].entry;
  }
  function resolveProjectFiles(entries, options = {}) {
    for (const entry of entries || []) {
      if (/\.(?:c|yaml|md)$/i.test(entry.name)) {
        safeFilename(entry.name);
        if (!parseProjectFilename(entry.name)) throw Error(`Invalid project file version or name: ${entry.name}. Use Ver.X.Y.Z with a positive file version and optional lowercase revision.`);
      }
    }
    const items = (entries || []).map((entry) => ({ entry, parsed: parseProjectFilename(entry.name) })).filter((item) => item.parsed && !["AGENTS.md", "00_README.md"].includes(item.entry.name));
    const specifications = items.filter((item) => item.parsed.extension === "md" && !item.parsed.purpose);
    const variant = options.variant || "";
    const selectedSpecifications = specifications.filter((item) => item.parsed.variant === variant);
    if (specifications.length && !selectedSpecifications.length) throw Error("Choose an explicit language or purpose variant for the project specification; no matching file exists.");
    const candidates = options.title ? selectedSpecifications.filter((item) => item.parsed.baseName === options.title || projectIdentity(item.entry.content)?.title === options.title) : selectedSpecifications;
    if (!candidates.length) throw Error("A project specification Markdown file is required.");
    const titles = unique(candidates.map((item) => projectIdentity(item.entry.content)?.title || item.parsed.baseName));
    if (titles.length !== 1) throw Error("Choose one project specification; multiple project names are present.");
    const identities = candidates.map((item) => projectIdentity(item.entry.content)).filter(Boolean);
    const versions = unique(identities.map((item) => item.version));
    if (!options.version && versions.length > 1) throw Error("Choose one project version; incompatible Ver.X.Y specifications cannot be combined.");
    const version = options.version || versions[0] || "";
    const specification = choose(candidates, version, "project specification", variant);
    const identity = projectIdentity(specification.content);
    if (identity && options.version && identity.version !== options.version) throw Error("The selected project version disagrees with its specification.");
    const title = identity?.title || options.title || parseProjectFilename(specification.name).baseName;
    const confirmed = alternatives(specification.content);
    function output(extension, confirmedName, role) {
      const candidates = items.filter((item) => item.parsed.extension === extension);
      if (confirmedName) {
        const matches = candidates.filter((item) => item.entry.name === confirmedName);
        if (matches.length > 1) throw Error(`Ambiguous confirmed ${role} filename ${confirmedName}.`);
        const other = candidates.filter((item) => item.entry.name !== confirmedName && item.parsed.baseName !== title);
        if (other.length) throw Error(`Unexpected ${role} file ${other[0].entry.name}; confirm its role before importing.`);
        return matches[0]?.entry || null;
      }
      const unrelated = candidates.filter((item) => item.parsed.baseName !== title || item.parsed.purpose);
      if (unrelated.length) throw Error(`The existing ${role} filename ${unrelated[0].entry.name} does not match project ${title}. Confirm a complete alternative C/YAML pair in the specification.`);
      return choose(candidates, version, role);
    }
    const source = output("c", confirmed?.sourceName, "C program");
    const resources = output("yaml", confirmed?.resourcesName, "resource YAML");
    const descriptions = items.filter((item) => item.parsed.extension === "md" && item.parsed.purpose === "description");
    const unrelatedDescription = descriptions.find((item) => item.parsed.baseName !== title);
    if (unrelatedDescription) throw Error(`The code description filename ${unrelatedDescription.entry.name} does not match project ${title}. Confirm its role or rename it explicitly.`);
    const guides = unique(descriptions.map((item) => item.parsed.variant)).map((variant) => choose(descriptions, version, "code description", variant));
    const guide = guides.find((entry) => !parseProjectFilename(entry.name).variant) || null;
    const warnings = [specification, source, resources, ...guides].filter(Boolean).flatMap((entry) => {
      const copy = parseProjectFilename(entry.name).copy;
      return copy > 1 ? [`Selected copy (${copy}): ${entry.name}. A copy suffix may indicate an accidental duplicate; confirm that this is the intended file.`] : [];
    });
    return { specification, source, resources, guide, guides, alternatives: confirmed, identity, warnings };
  }

  const V2_CONTRACT = "uartdebug-project/v2";
  const V3_CONTRACT = "uartdebug-project/v3";
  const V3_NAME = /^[A-Za-z0-9_]{1,86}$/;

  function v3ProjectIdentity(markdown) {
    const headings = [...specificationText(markdown).matchAll(/^#[ \t]+([^\n]+)$/gm)];
    const title = headings[0]?.[1].trim();
    return headings.length === 1 && typeof title === "string" && V3_NAME.test(title) ? { title, version: "" } : null;
  }

  function v3ProjectTarget(markdown) {
    const header = specificationText(markdown).split(/^##[ \t]+/m, 1)[0];
    const matches = [...header.matchAll(/^(?:Microcontroller|Микроконтроллер):[ \t]*([A-Za-z0-9-]{2,32})[ \t]*;[ \t]*(?:Package|Корпус):[ \t]*([A-Za-z0-9-]{2,32})[ \t]*$/gmi)];
    return matches.length === 1 ? { mcu: matches[0][1].toLowerCase(), packageName: matches[0][2] } : null;
  }

  function v3TaskHeadings(markdown) {
    const headings = [];
    let ancestors = [];
    for (const [line, text] of specificationText(markdown).split("\n").entries()) {
      const heading = /^ {0,3}(#{2,4})[ \t]+(.+)$/.exec(text);
      if (!heading) continue;
      const level = heading[1].length;
      const rawTitle = heading[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
      if (!rawTitle) continue;
      const suffix = /^(.*\S)[ \t]+([1-9]\d*(?:\.[1-9]\d*){0,2})$/.exec(rawTitle);
      const number = suffix && suffix[2].split(".").length === level - 1 ? suffix[2] : "";
      const title = number ? suffix[1] : rawTitle;
      const service = level === 2 && /^(?:Продолжение работы|Continue work)$/iu.test(title);
      const parents = ancestors.slice(0, level - 2);
      headings.push({ line, level, title, rawTitle, number, parents, service });
      ancestors = service ? [] : [...parents, title];
    }
    return headings;
  }

  function findV3TaskHeading(markdown, { title, level, parents } = {}) {
    if (typeof title !== "string" || !title.trim() ||
        (parents != null && (!Array.isArray(parents) || parents.some(parent => typeof parent !== "string")))) return null;
    const normalizeTitle = value => value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
    const expectedTitle = normalizeTitle(title);
    const headings = Array.isArray(markdown) ? markdown : v3TaskHeadings(markdown);
    const matches = headings.filter(heading => !heading.service &&
      (level === undefined || level === heading.level) &&
      (!parents || parents.length === heading.parents.length &&
        parents.every((parent, index) => normalizeTitle(parent) === normalizeTitle(heading.parents[index]))) &&
      (normalizeTitle(heading.title) === expectedTitle || normalizeTitle(heading.rawTitle) === expectedTitle));
    // A reused number after reordering is not an identity for duplicate headings.
    return matches.length === 1 ? matches[0] : null;
  }

  function v3TaskHeadingNumberError(markdown) {
    const counts = [0, 0, 0];
    let lastLevel = 1;
    const headings = Array.isArray(markdown) ? markdown : v3TaskHeadings(markdown);
    for (const heading of headings) {
      if (heading.service) {
        if (heading.number) return { ...heading, expected: "" };
        lastLevel = 1;
        continue;
      }
      const level = heading.level;
      if (level > lastLevel + 1) return { ...heading, expected: null };
      const depth = level - 2;
      counts[depth]++;
      counts.fill(0, depth + 1);
      const expected = counts.slice(0, depth + 1).join(".");
      if (heading.number !== expected) return { ...heading, expected };
      lastLevel = level;
    }
    return null;
  }

  function v3Dialogue(markdown) {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const replies = [];
    const prefix = /^(AI-[1-9][0-9]{0,11})[ \t]+:[ \t]+(.+)$/;
    const markerLine = /^([?+]:)(?:[ \t]+(.*))?$/;
    for (let startLine = 0; startLine < lines.length; startLine++) {
      const line = lines[startLine];
      const listFence = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(line);
      const fence = /^ {0,3}([\x60~]{3,})(.*)$/.exec(listFence ? line.slice(listFence[0].length) : line);
      if (fence && /^([\x60]+|~+)$/.test(fence[1])) {
        const marker = fence[1];
        const closing = new RegExp("^ {0,3}" + marker[0] + "{" + marker.length + ",}[ \\t]*$");
        let endLine = startLine + 1;
        while (endLine < lines.length && !closing.test(lines[endLine])) endLine++;
        const match = prefix.exec(lines[startLine + 1] || "");
        if (!listFence && match && marker[0] === "\x60" && fence[2].trim() === "text") {
          const promptLine = endLine + 1;
          const prompt = markerLine.exec(lines[promptLine] || "");
          replies.push({
            id: match[1], startLine, endLine, promptLine, marker: prompt?.[1] || "",
            text: [match[2], ...lines.slice(startLine + 2, endLine)].join("\n"),
            inlineAnswer: prompt?.[2] || "", answered: !!prompt?.[2]?.trim(), valid: marker.length === 3 && !!prompt &&
              lines[endLine]?.trim() === "\x60\x60\x60",
          });
        }
        startLine = endLine;
        continue;
      }
      const short = /^ {0,3}\x60([^\x60]+)\x60(?:[ \t]+(\?:)(?:[ \t]+(.*))?)?$/.exec(line);
      const match = short && prefix.exec(short[1]);
      if (!match) continue;
      const accepted = !short[2] && markerLine.exec(lines[startLine + 1] || "");
      const marker = short[2] || (accepted?.[1] === "+:" ? "+:" : "");
      replies.push({
        id: match[1], startLine, endLine: startLine, promptLine: startLine + (short[2] ? 0 : 1),
        marker, text: match[2], inlineAnswer: short[3] || accepted?.[2] || "",
        answered: !!(short[3] || accepted?.[2])?.trim(),
        valid: [...match[2]].length <= 35 && !!marker,
      });
    }
    const starts = new Set(replies.map(reply => reply.startLine));
    for (const reply of replies) {
      if (!reply.valid || reply.answered) continue;
      let answerLine = reply.promptLine + 1;
      while (answerLine < lines.length && !lines[answerLine].trim()) answerLine++;
      reply.answered = answerLine < lines.length && !starts.has(answerLine) &&
        !/^ {0,3}#{1,6}[ \t]/.test(lines[answerLine]);
    }
    return replies;
  }


  function normalizeTaskDialogue(value = []) {
    const invalid = () => { throw Error("Invalid task discussion records."); };
    const validText = (text, max, empty = true) => typeof text === "string" &&
      (empty || !!text.trim()) && !text.includes("\0") && bytes(text) <= max;
    if (!Array.isArray(value) || value.length > 100 || bytes(JSON.stringify(value)) > 128 * 1024) invalid();
    const ids = new Set();
    return value.map(record => {
      const { id, kind, anchor, message, options, answer = "", choice = null, submitted = false } = record || {};
      if (typeof id !== "string" || !/^AI-[1-9][0-9]{0,11}$/.test(id) || ids.has(id) ||
          !["question", "decision", "note", "next"].includes(kind) ||
          !anchor || ![0, 2, 3, 4].includes(anchor.level) ||
          !validText(anchor.title, 1024) || !validText(anchor.number, 48) ||
          (anchor.parents !== undefined && (!Array.isArray(anchor.parents) || anchor.parents.length > 2 ||
            anchor.parents.some(title => !validText(title, 1024, false)))) ||
          !validText(message, 24000, false) || !Array.isArray(options) || options.length > 4 ||
          (kind === "next" && options.length !== 3) ||
          (["decision", "note"].includes(kind) && options.length) ||
          options.some(option => !validText(option, 1120, false)) ||
          (choice !== null && (!Number.isInteger(choice) || choice < 0 || choice >= options.length)) ||
          !validText(answer, 12000) || typeof submitted !== "boolean") invalid();
      ids.add(id);
      const clean = text => text.replace(/\r\n?/g, "\n");
      const heading = {
        title: clean(anchor.title), number: clean(anchor.number), level: anchor.level,
        ...(anchor.parents !== undefined ? { parents: anchor.parents.map(clean) } : {}),
      };
      return { id, kind, anchor: heading, message: clean(message), options: options.map(clean),
        answer: clean(choice === null ? answer : options[choice]), choice, submitted };
    });
  }

  function migrateV3TaskDialogue(markdown, value) {
    const dialogue = normalizeTaskDialogue(value);
    const replies = v3Dialogue(markdown);
    if (!replies.length) return { markdown, dialogue };
    const ids = new Set(dialogue.map(record => record.id));
    const duplicateIds = new Set(replies.filter((reply, index) =>
      replies.findIndex(candidate => candidate.id === reply.id) !== index).map(reply => reply.id));
    const headings = v3TaskHeadings(markdown);
    const lines = markdown.split(/\r\n?|\n/);
    const separators = markdown.match(/\r\n?|\n/g) || [];
    const replyStarts = new Set(replies.map(reply => reply.startLine));
    const removed = new Set();
    for (const reply of replies) {
      if (!reply.valid || ids.has(reply.id) || duplicateIds.has(reply.id)) continue;
      const boundary = line => /^ {0,3}(?:#{1,6}[ \t]|>|[\x60~]{3,}|(?:[-+*]|\d+[.)])[ \t]+[\x60~]{3,}|[-*_]{3,}[ \t]*$)/.test(line);
      const followingHeadings = headings.filter(heading => heading.line < reply.startLine);
      let heading = followingHeadings.at(-1);
      const acceptedMarker = reply.marker === "+:";
      const firstAnswer = reply.inlineAnswer.trim();
      const followingLine = lines[reply.promptLine + 1] || "";
      const immediateAnswer = followingLine.trim() && !replyStarts.has(reply.promptLine + 1) && !boundary(followingLine);
      // A +: followed by text after a blank line may be a reopened decision or
      // unrelated prose. Keep that ambiguous exchange byte-for-byte.
      if (acceptedMarker && reply.answered && !firstAnswer && !immediateAnswer) continue;
      const bareDecision = /^(?:Техническое решение|Technical decision|Technical solution)\.?\s*$/iu.test(reply.text);
      const decision = acceptedMarker && !reply.answered && !bareDecision;
      if (decision && heading?.level === 4) {
        heading = followingHeadings.findLast(heading => heading.level === 2 || heading.level === 3);
      }
      const next = !acceptedMarker && heading?.service;
      let answerEnd = reply.promptLine;
      // An empty +: marker leaves surrounding task prose in place. A ?: marks
      // an active answer, which may continue across paragraphs until a boundary.
      if (!acceptedMarker || firstAnswer || immediateAnswer) {
        for (let index = reply.promptLine + 1; index < lines.length; index++) {
          const line = lines[index];
          if (replyStarts.has(index) || boundary(line)) break;
          if (line.trim()) answerEnd = index;
        }
      }
      const answer = [firstAnswer, ...lines.slice(reply.promptLine + 1, answerEnd + 1)].join("\n").trim();
      const options = !next ? [] : /^Продолжение работы$/iu.test(heading.title)
        ? ["Сгенерировать код", "Продолжить работу над следующим блоком", "Приостановить работу"]
        : ["Generate code", "Continue with the next block", "Pause"];
      const anchor = heading && !heading.service
        ? { title: heading.title, number: heading.number, level: heading.level, parents: heading.parents }
        : { title: "", number: "", level: 0 };
      const record = { id: reply.id, kind: decision ? "decision" : next ? "next" : "question", anchor,
        message: reply.text, options, answer, choice: null, submitted: false };
      try {
        normalizeTaskDialogue([...dialogue, record]);
      } catch {
        // Keep malformed and over-limit legacy blocks in the original document.
        continue;
      }
      dialogue.push(record);
      ids.add(record.id);
      for (let index = reply.startLine; index <= answerEnd; index++) removed.add(index);
    }
    return {
      markdown: removed.size ? lines.map((line, index) =>
        removed.has(index) ? "" : line + (separators[index] || "")).join("") : markdown,
      dialogue,
    };
  }

  function v3ProjectOutputNames(identity, currentProject = null) {
    const title = identity?.title;
    if (typeof title !== "string" || !V3_NAME.test(title)) throw Error("Specify a project name with Latin letters, digits or underscores.");
    const sourceName = safeFilename(title + ".c", /\.c$/);
    const resourcesName = safeFilename(title + ".yaml", /\.yaml$/);
    if ((currentProject?.source?.trim() && currentProject.sourceName !== sourceName) ||
        (currentProject?.specification?.content?.trim() && currentProject.specification.name !== resourcesName)) {
      throw Error("The existing C file and information model must share the task filename stem.");
    }
    return { sourceName, resourcesName };
  }

  function normalizeReferenceFiles(value, title) {
    if (value == null || (Array.isArray(value) && value.length === 0)) return [];
    if (typeof title !== "string" || !V3_NAME.test(title) || !Array.isArray(value) || value.length !== 3) {
      throw Error("A saved reference group requires exactly three files.");
    }
    return ["md", "yaml", "c"].map(extension => {
      const name = safeFilename(`${title}.1.${extension}`);
      const file = value.find(candidate => candidate?.name === name);
      if (!file || typeof file.content !== "string" || file.content.includes("\0") || bytes(file.content) > 256 * 1024) {
        throw Error(`Missing or invalid reference file: ${name}.`);
      }
      return { name, content: file.content };
    });
  }

  function resolveV3ProjectFiles(entries, folderTitle = "") {
    const specs = entries.filter(entry => {
      const identity = v3ProjectIdentity(entry.content);
      if (!identity || entry.name !== identity.title + ".md") return false;
      const title = identity.title;
      const hasReference = entries.some(file =>
        [".1.md", ".1.yaml", ".1.c"].some(suffix => file.name === title + suffix));
      const primaryNames = [title + ".md", title + ".c", title + ".yaml", title + ".Description.md"];
      return v3ProjectTarget(entry.content) || hasReference ||
        (!metadata(entry.content, versionLabel).length && entries.every(file => primaryNames.includes(file.name)));
    });
    if (!specs.length) return null;
    if (specs.length !== 1) throw Error("Choose one project task before importing.");
    const specification = specs[0];
    const identity = v3ProjectIdentity(specification.content);
    const title = identity.title;
    if (folderTitle && folderTitle !== title) {
      throw Error("The UartDebug3 folder, task heading and primary files must share the same name.");
    }
    const names = v3ProjectOutputNames(identity);
    const byName = new Map(entries.map(entry => [safeFilename(entry.name), entry]));
    if (byName.size !== entries.length) throw Error("Duplicate project filenames.");
    const source = byName.get(names.sourceName) || null;
    const resources = byName.get(names.resourcesName) || null;
    const referenceFiles = normalizeReferenceFiles(
      entries.filter(entry => [".1.md", ".1.yaml", ".1.c"].some(suffix => entry.name === title + suffix)),
      title,
    );
    const guides = entries.filter(entry => entry !== specification && entry.name.startsWith(title + ".") && /\.md$/i.test(entry.name) &&
      !/^\d+$/.test(entry.name.slice(title.length + 1, -3)));
    if (guides.length > 1) throw Error("Select one Markdown description before importing.");
    const workingFile = name => name.startsWith(title + ".") && /^\d+\.(?:md|c|yaml)$/.test(name.slice(title.length + 1));
    const selected = new Set([specification, source, resources, ...guides]);
    const unexpected = entries.find(entry => !selected.has(entry) && !workingFile(entry.name));
    if (unexpected) throw Error(`Unexpected UartDebug3 project file: ${unexpected.name}.`);
    return { specification, source, resources, guide: guides[0] || null, guides, identity, referenceFiles,
      contract: V3_CONTRACT, target: v3ProjectTarget(specification.content), warnings: [] };
  }

  function isLocaleTag(value) {
    if (typeof value !== "string" || value.length > 35 || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:-[0-9a-wy-z](?:-[a-z0-9]{2,8})+)*(?:-x(?:-[a-z0-9]{1,8})+)?$/i.test(value)) return false;
    const singletons = new Set();
    for (const subtag of value.toLowerCase().split("-").slice(1)) {
      if (subtag === "x") break;
      if (subtag.length !== 1) continue;
      if (singletons.has(subtag)) return false;
      singletons.add(subtag);
    }
    return true;
  }

  function inferLocale(value, fallback = "") {
    const text = String(value || "").replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "");
    if (/[А-Яа-яЁё]/.test(text)) return "ru";
    if (/\b(?:the|this|requirements|microcontroller|program|set|use|using|with|without|should|must)\b/i.test(text)) return "en";
    return fallback;
  }
  function remarkLabels(locale) {
    return String(locale || "").toLowerCase().split("-")[0] === "ru" ?
      { prefix: "ИИ", question: "Вопрос", information: "Информация", error: "Ошибка", user: "Пользователь", ai: "ИИ", resolved: "Решено в предыдущей версии спецификации." } :
      { prefix: "AI", question: "Question", information: "Information", error: "Error", user: "User", ai: "AI", resolved: "Resolved in the previous specification." };
  }
  function normalizeProjectDocuments(value) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 2) throw Error("Project documents must contain at most AGENTS.md and 00_README.md.");
    let total = 0;
    const names = new Set();
    return value.map((document) => {
      if (!document || !["AGENTS.md", "00_README.md"].includes(document.name) || names.has(document.name) || typeof document.content !== "string" || document.content.includes("\0") || bytes(document.content) > 32 * 1024) throw Error("Local project rules require unique AGENTS.md/00_README.md files, up to 32 KiB each, without NUL characters.");
      names.add(document.name);
      total += bytes(document.content);
      if (total > 64 * 1024) throw Error("Local project rules exceed 64 KiB.");
      return { name: document.name, content: document.content };
    });
  }
  return { specificationText, projectIdentity, projectOutputNames, parseProjectFilename, resolveProjectFiles,
    V2_CONTRACT, V3_CONTRACT, v3ProjectIdentity, v3ProjectTarget, v3Dialogue, v3ProjectOutputNames, normalizeReferenceFiles, resolveV3ProjectFiles,
    v3TaskHeadings, findV3TaskHeading, v3TaskHeadingNumberError, normalizeTaskDialogue, migrateV3TaskDialogue,
    isLocaleTag, inferLocale, remarkLabels, normalizeProjectDocuments };
});
