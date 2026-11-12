"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const format = require("../backend/avr-project-format");
const { specificationText, projectIdentity, projectOutputNames, parseProjectFilename, resolveProjectFiles, isLocaleTag, inferLocale, remarkLabels, normalizeProjectDocuments } = format;
const spec = (title = "Demo", version = "Ver.1.0") => `# Project ${title}\n\nProject version - ${version}\n\n## Hardware requirements\n\nATtiny1624 SOIC-14.\n\n## Software requirements\n\nSet PA3 high.\n`;
const entry = (name, content = "contents") => ({ name, content });

test("browser and backend execute the exact same project format source", () => {
  const source = fs.readFileSync(path.join(__dirname, "../backend/avr-project-format.js"), "utf8");
  assert.equal(source, fs.readFileSync(path.join(__dirname, "../public/avr-project-format.js"), "utf8"));
  const context = { TextEncoder };
  vm.runInNewContext(source, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.UartDebugAvrProjectFormat.projectIdentity(spec()))), projectIdentity(spec()));
  assert.deepEqual(Object.keys(context.UartDebugAvrProjectFormat).sort(), Object.keys(format).sort());
});

test("legacy task dialogue migrates unambiguously while preserving ordinary Markdown and saved answers", () => {
  const lines = ["# Blink", "## Indicator 1", "### Output 1.1", "Keep this requirement.",
    "> `AI-15 : Quoted example.` ?: No conversion.", "````markdown", "```text", "AI-16 : Fenced example.", "```", "?: No conversion.", "````",
    "- ```text", "  `AI-17 : List example.` ?: No conversion.", "  ```",
    "```text", "AI-1 : Technical decision.", "Use PA3 in output mode.", "```", "+: ", "",
    "### Timing 1.2", "`AI-2 : Which period?` ?: Use `500 ms`.", "", "The LED should start low.", "",
    "## Продолжение работы", "```text", "AI-3 : Что делать дальше?", "```", "?: ", "", "Генерируй код", ""];
  const { markdown, dialogue } = format.migrateV3TaskDialogue(lines.join("\r\n"));
  assert.equal(markdown, [...lines.slice(0, 14), "", lines[20], "", lines[25], ""].join("\r\n"));
  assert.deepEqual(dialogue.map(record => [record.id, record.kind, record.anchor.parents, record.answer, record.submitted]), [
    ["AI-1", "decision", ["Indicator"], "", false], ["AI-2", "question", ["Indicator"], "Use `500 ms`.\n\nThe LED should start low.", false],
    ["AI-3", "next", undefined, "Генерируй код", false],
  ]);
  assert.match(dialogue[0].message, /Use PA3 in output mode/);
  assert.equal(dialogue[2].options.length, 3);
  assert.deepEqual(format.migrateV3TaskDialogue(markdown, dialogue), { markdown, dialogue });
});

test("legacy decisions with a reopened response or no substantive decision remain unresolved", () => {
  const markdown = ["## Indicators 1", "### Output 1.1", "```text", "AI-1 : Technical decision.", "Use PA3.", "```",
    "+: Try PA4 instead.", "Why is PA3 necessary?", "", "### Timing 1.2", "`AI-2 : Technical decision.`", "+: ", "",
    "### Startup 1.3", "`AI-3 : Start low.`", "+: ", "", "Keep ambiguous prose after the marker.", ""].join("\n");
  const migrated = format.migrateV3TaskDialogue(markdown);
  assert.deepEqual(migrated.dialogue.map(record => [record.kind, record.answer]), [
    ["question", "Try PA4 instead.\nWhy is PA3 necessary?"], ["question", ""],
  ]);
  assert.match(migrated.markdown, /`AI-3 : Start low\.`\n\+: \n\nKeep ambiguous prose after the marker\./);
});

test("UartDebug3 task headings parse consecutive numbers and exclude the service heading and examples", () => {
  const markdown = ["# Blink", "## 1 Indicator", "### 1.1 LED", "#### 1.1.1 Output", "### 1.2 Timing", "",
    "> ## 9 Quoted example", "```markdown", "## 8 Fenced example", "```", "## Continue work", "## 2 UART", "### 2.1 Baud"].join("\n");
  const headings = format.v3TaskHeadings(markdown);
  assert.deepEqual(headings.map(({ title, number, service }) => [title, number, service]), [
    ["Indicator", "1", false], ["LED", "1.1", false], ["Output", "1.1.1", false], ["Timing", "1.2", false],
    ["Continue work", "", true], ["UART", "2", false], ["Baud", "2.1", false],
  ]);
  assert.deepEqual(headings[2].parents, ["Indicator", "LED"]);
  assert.equal(format.v3TaskHeadingNumberError(markdown), null);
  assert.equal(format.v3TaskHeadingNumberError(markdown.replace("1.2 Timing", "1.3 Timing")).expected, "1.2");
  assert.equal(format.v3TaskHeadingNumberError("# Blink\n### 1.1 Orphan").expected, null);
  assert.equal(format.v3TaskHeadingNumberError(markdown.replace("Continue work", "2 Continue work")).expected, "");
});

test("prefix numbering preserves literal numbers in titles and recognizes legacy suffixes", () => {
  const prefix = "## 1 Timer 2\n### 1.1 Overflow";
  const suffix = "## 5 V supply 1\n### Output 1.1";
  assert.equal(format.v3TaskHeadings(prefix)[0].title, "Timer 2");
  assert.equal(format.v3TaskHeadings(suffix)[0].title, "5 V supply");
  assert.equal(format.v3TaskHeadingNumberError(suffix).numberPosition, "suffix");
  assert.equal(format.v3TaskHeadingNumberError(suffix, { allowSuffix: true }), null);
  assert.equal(format.v3TaskHeadingNumberError(suffix + "\nNew prose.", { previousMarkdown: suffix }), null);
  const anchor = { title: "Output", level: 3, parents: ["5 V supply"] };
  assert.equal(format.findV3TaskHeading("## 5 V supply\n### Output", anchor).line, 1);
  assert.equal(format.findV3TaskHeading("## 1 5 V supply\n### 1.1 Output", anchor).number, "1.1");
  assert.equal(format.findV3TaskHeading("## 1 MHz clock 1\n### Output 1.1", {
    ...anchor, parents: ["1 MHz clock"],
  }).number, "1.1");
});

test("UartDebug3 resolves repeated headings by ancestry after reordering and refuses ambiguous old anchors", () => {
  const markdown = "# Demo\n## Receive 1\n### Clock 1.1\n## Send 2\n### Clock 2.1\n";
  const reordered = "# Demo\n## 1 Send\n### 1.1 Clock\n## 2 Receive\n### 2.1 Clock\n";
  const anchor = { title: "Clock", number: "1.1", level: 3, parents: ["Receive"] };
  assert.equal(format.findV3TaskHeading(markdown, anchor).number, "1.1");
  assert.equal(format.findV3TaskHeading(reordered, anchor).number, "2.1");
  assert.equal(format.findV3TaskHeading(reordered, { title: "Clock", number: "1.1", level: 3 }), null);
  assert.equal(format.findV3TaskHeading("# Demo\n## Timer 2\n### Overflow\n", { title: "Timer 2", level: 2 }).rawTitle, "Timer 2");
});

test("identity and filenames ignore code examples, quotes, AI discussion and unapplied instructions", () => {
  const markdown = `${spec()}\n\`\`\`markdown\n# Project Fake\nProject version - Ver.9.9\nC program file - wrong.c\nProject resources file - wrong.yaml\n\`\`\`\n\n> # Project Quoted\n> ###### *[AI.1] Question.*\n>\n> Which target?\n# Project Reply\nProject version - Ver.8.8\n\n!+\n# Project Temporary\nProject version - Ver.7.7\n!-\n\n    # Project Indented\n    Project version - Ver.6.6\n`;
  assert.deepEqual(projectIdentity(markdown), { title: "Demo", version: "Ver.1.0" });
  assert.deepEqual(projectOutputNames(markdown, projectIdentity(markdown)), { sourceName: "Demo.c", resourcesName: "Demo.yaml" });
  assert.doesNotMatch(specificationText(markdown), /Fake|Quoted|Reply|Temporary|Indented|wrong/);
  assert.equal(projectIdentity("```markdown\n# Project Example\nProject version - Ver.9.9\n```"), null);
  assert.equal(projectIdentity("- ```markdown\n# Project Example\nProject version - Ver.9.9\n```"), null);
});

test("localized metadata uses the same explicit identity rules", () => {
  for (const [name, version] of [["Проект", "Версия проекта"], ["Proyecto", "Versión del proyecto"], ["Projet", "Version du projet"], ["Projekt", "Projektversion"]]) {
    assert.deepEqual(projectIdentity(`# ${name} Demo\n${version} - Ver.2.3`), { title: "Demo", version: "Ver.2.3" });
  }
  assert.equal(projectIdentity(spec() + "\n# Project Other\n"), null);
  assert.equal(projectIdentity(spec() + "\nProject version - Ver.3.0\n"), null);
  assert.equal(projectIdentity(spec("Demo", "1.0")), null);
});

test("UTF-8 BOM and CRLF affect only the semantic view, never imported specification content", () => {
  const markdown = "\ufeff" + spec().replace(/\n/g, "\r\n");
  assert.deepEqual(projectIdentity(markdown), { title: "Demo", version: "Ver.1.0" });
  const selected = resolveProjectFiles([entry("Demo.md", markdown)]);
  assert.equal(selected.specification.content, markdown);
  assert.equal(specificationText(markdown).startsWith("# Project Demo\n"), true);
});

test("output names accept compatible versioned files and require a confirmed complete alternative pair", () => {
  const identity = projectIdentity(spec());
  const current = { sourceName: "Demo Ver.1.0.2-a (en)(3).c", source: "existing", specification: { name: "Demo Ver.1.0.1.yaml", content: "existing" } };
  assert.equal(projectOutputNames(spec(), identity, current).sourceName, current.sourceName);
  assert.throws(() => projectOutputNames(spec(), identity, { ...current, sourceName: "Other.c" }), /complete alternative/i);
  assert.throws(() => projectOutputNames(spec(), identity, { ...current, sourceName: "Demo Ver.2.0.1.c" }), /does not match/);
  const alternate = spec() + "\nC program file - firmware.c\nProject resources file - allocations.yaml\n";
  assert.deepEqual(projectOutputNames(alternate, identity, current), { sourceName: "firmware.c", resourcesName: "allocations.yaml" });
  for (const suffix of ["\nC program file - firmware.c", "\nC program file - ../firmware.c\nProject resources file - allocations.yaml", "\nC program file - firmware.c\nC program file - other.c\nProject resources file - allocations.yaml"]) assert.throws(() => projectOutputNames(spec() + suffix, identity));
});

test("filename parsing distinguishes versions, editions, variants, descriptions and copies", () => {
  assert.deepEqual(parseProjectFilename("Demo Ver.2.3.4-b (ru)(7).c"), { name: "Demo Ver.2.3.4-b (ru)(7).c", stem: "Demo Ver.2.3.4-b (ru)(7)", extension: "c", baseName: "Demo", version: { major: 2, minor: 3, file: 4, revision: "b" }, variant: "ru", copy: 7, purpose: "" });
  for (const name of ["Demo (description) Ver.1.0.2 (ru).md", "Demo Ver.1.0.2 (description) (ru).md", "Demo.guide (ru).md", "Demo_description (ru).md", "Demo.description (ru).md"]) {
    const parsed = parseProjectFilename(name);
    assert.equal(parsed.baseName, "Demo");
    assert.equal(parsed.purpose, "description");
    assert.equal(parsed.variant, "ru");
  }
  for (const name of ["Demo Ver.1.0.c", "Demo Ver.1.0.0.c", "Demo Ver.1.0.1-A.c", "../Demo.c"]) assert.equal(parseProjectFilename(name), null);
});

test("resolver ranks matching project version, file version, edition and copy without mixing variants", () => {
  const entries = [entry("Demo.md", spec()), entry("Demo.c"), entry("Demo Ver.1.0.1-z.c"), entry("Demo Ver.1.0.2.c"), entry("Demo Ver.1.0.2-a.c"), entry("Demo Ver.1.0.2-a(3).c"), entry("Demo Ver.1.0.2-a(2).c"), entry("Demo Ver.9.0.999.c"), entry("Demo Ver.1.0.100 (ru).c"), entry("Demo.yaml"), entry("Demo (description).md", "English program description."), entry("Demo (description) Ver.1.0.2 (ru).md", "Описание программы."), entry("Demo (description) Ver.1.0.1 (ru).md", "Раннее описание.")];
  const selected = resolveProjectFiles(entries);
  assert.equal(selected.source.name, "Demo Ver.1.0.2-a(3).c");
  assert.equal(selected.resources.name, "Demo.yaml");
  assert.equal(selected.guide.name, "Demo (description).md");
  assert.deepEqual(selected.guides.map((item) => item.name), ["Demo (description).md", "Demo (description) Ver.1.0.2 (ru).md"]);
  assert.deepEqual(selected.identity, { title: "Demo", version: "Ver.1.0" });
});

test("resolver keeps incomplete drafts usable and refuses ambiguous or incompatible selections", () => {
  assert.equal(resolveProjectFiles([entry("Draft.md", "")]).identity, null);
  assert.equal(resolveProjectFiles([entry("Draft.md", "# Project Draft")]).source, null);
  assert.throws(() => resolveProjectFiles([entry("Demo.md", spec()), entry("Other.md", spec("Other"))]), /multiple project names/);
  assert.throws(() => resolveProjectFiles([entry("Demo Ver.1.0.1.md", spec()), entry("Demo Ver.2.0.1.md", spec("Demo", "Ver.2.0"))]), /incompatible/);
  assert.throws(() => resolveProjectFiles([entry("Demo.md", spec()), entry("Demo (ru).c")]), /explicit language/);
  assert.throws(() => resolveProjectFiles([entry("Demo.md", spec()), entry("Demo Ver.2.0.1.c")]), /No C program matches/);
  assert.throws(() => resolveProjectFiles([entry("Demo.md", spec()), entry("Demo.c"), entry("Demo.c")]), /same version/);
  assert.throws(() => resolveProjectFiles([entry("Demo.md", spec()), entry("Wrong.c")]), /complete alternative/);
});

test("specification variants are fixed before deriving project identity and compatible version", () => {
  const entries = [entry("Demo.md", spec()), entry("Demo Ver.2.0.1 (ru).md", spec("Demo", "Ver.2.0")), entry("Demo.c")];
  const selected = resolveProjectFiles(entries);
  assert.deepEqual(selected.identity, { title: "Demo", version: "Ver.1.0" });
  assert.equal(selected.specification.name, "Demo.md");
  const russian = resolveProjectFiles(entries, { variant: "ru" });
  assert.deepEqual(russian.identity, { title: "Demo", version: "Ver.2.0" });
  assert.equal(russian.specification.name, "Demo Ver.2.0.1 (ru).md");
  assert.throws(() => resolveProjectFiles([entries[1]]), /explicit language/);
  assert.throws(() => resolveProjectFiles(entries, { variant: "de" }), /explicit language/);
});

test("selected copy suffixes are reported without renaming files or warning about unselected copies", () => {
  const selected = resolveProjectFiles([entry("Demo(2).md", spec()), entry("Demo.c"), entry("Demo Ver.1.0.1(3).c"), entry("Demo Ver.1.0.1(2).c"), entry("Demo.yaml"), entry("Demo (description)(4).md", "Program description.")]);
  assert.deepEqual(selected.warnings.map((warning) => /^Selected copy \((\d+)\):/.exec(warning)?.[1]), ["2", "3", "4"]);
  assert.equal(selected.source.name, "Demo Ver.1.0.1(3).c");
  assert.equal(selected.warnings.some((warning) => warning.includes("Demo Ver.1.0.1(2).c")), false);
  assert.deepEqual(resolveProjectFiles([entry("Demo.md", spec()), entry("Demo.c")]).warnings, []);
});

test("bounded shared locale validation accepts extension/private tags and rejects malformed chains", () => {
  for (const locale of ["en", "en-US", "ru-RU", "und", "ru-x-default", "en-x-1", "de-u-ca-gregory", "en-a-example-x-private"]) assert.equal(isLocaleTag(locale), true, locale);
  for (const locale of [null, 1, "", "ru-x", "ru-u", "ru_x_default", "en--US", "en-x-", "en-a-x-test", "en-a-foo-a-bar", "ru\0", "en-x-" + "a".repeat(36)]) assert.equal(isLocaleTag(locale), false, String(locale));
});

test("locales are inferred only when known and explicit regional labels share display terms", () => {
  assert.equal(inferLocale("Описание текущей программы."), "ru");
  assert.equal(inferLocale("This program sets the pin high."), "en");
  assert.equal(inferLocale("La description du code."), "");
  assert.equal(inferLocale("", "fr"), "fr");
  assert.equal(remarkLabels("ru-RU").question, "Вопрос");
  assert.equal(remarkLabels("en-US").question, "Question");
});

test("project-local rules retain exact bytes and have one bounded explicit scope", () => {
  const docs = [{ name: "AGENTS.md", content: "# Rules\r\n\nПример\r\n" }, { name: "00_README.md", content: "Read local references." }];
  assert.deepEqual(normalizeProjectDocuments(docs), docs);
  assert.deepEqual(normalizeProjectDocuments(null), []);
  for (const invalid of [[docs[0], docs[0]], [{ name: "Notes.md", content: "x" }], [{ name: "AGENTS.md", content: "x\0" }], [{ name: "AGENTS.md", content: "я".repeat(16385) }]]) assert.throws(() => normalizeProjectDocuments(invalid));
});
