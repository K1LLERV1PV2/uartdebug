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
  return { specificationText, projectIdentity, projectOutputNames, parseProjectFilename, resolveProjectFiles, isLocaleTag, inferLocale, remarkLabels, normalizeProjectDocuments };
});
