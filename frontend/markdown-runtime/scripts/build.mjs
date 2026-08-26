import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entryPoint = resolve(packageRoot, "src/index.js");
const outputPath = resolve(
  packageRoot,
  "../../public/vendor/uartdebug-markdown.js"
);
const licenseOutputPath = resolve(
  packageRoot,
  "../../LICENSES/UartDebugMarkdownRuntime.txt"
);
const publicLicenseOutputPath = resolve(
  packageRoot,
  "../../public/vendor/uartdebug-markdown.LICENSE.txt"
);
const checkOnly = process.argv.includes("--check");

const result = await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: "iife",
  globalName: "UartDebugMarkdown",
  // The dependency's browser condition decodes entities through a temporary
  // element and `innerHTML`. The neutral export uses a static entity table,
  // keeping the vendored runtime entirely independent of HTML parsing sinks.
  platform: "neutral",
  target: ["es2020"],
  minify: true,
  legalComments: "eof",
  metafile: true,
  write: false,
  banner: {
    js: "/*! UartDebugMarkdown 1.0.0 | CommonMark + GFM runtime | Licenses: /vendor/uartdebug-markdown.LICENSE.txt */",
  },
});

const nextOutput = result.outputFiles[0].text.replace(/\r\n/g, "\n");
const nextLicenseOutput = await buildLicenseNotice(result.metafile);

if (checkOnly) {
  const stalePaths = [];
  if ((await readNormalized(outputPath)) !== nextOutput) {
    stalePaths.push("public/vendor/uartdebug-markdown.js");
  }
  if ((await readNormalized(licenseOutputPath)) !== nextLicenseOutput) {
    stalePaths.push("LICENSES/UartDebugMarkdownRuntime.txt");
  }
  if ((await readNormalized(publicLicenseOutputPath)) !== nextLicenseOutput) {
    stalePaths.push("public/vendor/uartdebug-markdown.LICENSE.txt");
  }
  if (stalePaths.length) {
    console.error(`${stalePaths.join(", ")} ${
      stalePaths.length === 1 ? "is" : "are"
    } stale. Run npm run build --prefix frontend/markdown-runtime.`);
    process.exitCode = 1;
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(licenseOutputPath), { recursive: true });
  await mkdir(dirname(publicLicenseOutputPath), { recursive: true });
  await writeFile(outputPath, nextOutput, "utf8");
  await writeFile(licenseOutputPath, nextLicenseOutput, "utf8");
  await writeFile(publicLicenseOutputPath, nextLicenseOutput, "utf8");
  console.log(`Built ${outputPath}`);
  console.log(`Built ${licenseOutputPath}`);
  console.log(`Built ${publicLicenseOutputPath}`);
}

async function buildLicenseNotice(metafile) {
  const packageNames = [...new Set(
    Object.keys(metafile.inputs)
      .map((inputPath) =>
        inputPath
          .replace(/\\/g, "/")
          .match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]
      )
      .filter(Boolean)
  )].sort();
  const sections = [];

  for (const packageName of packageNames) {
    const dependencyRoot = resolve(packageRoot, "node_modules", packageName);
    const packageJson = JSON.parse(
      await readFile(resolve(dependencyRoot, "package.json"), "utf8")
    );
    const licenseFile = (await readdir(dependencyRoot)).find((name) =>
      /^licen[cs]e(?:\.|$)/i.test(name)
    );
    if (!licenseFile) {
      throw new Error(`No license file found for bundled package ${packageName}.`);
    }
    const licenseText = (await readFile(
      resolve(dependencyRoot, licenseFile),
      "utf8"
    )).trim();
    sections.push([
      "=".repeat(80),
      `${packageName}@${packageJson.version} (${packageJson.license || "license in package"})`,
      "-".repeat(80),
      licenseText,
    ].join("\n"));
  }

  return [
    "UartDebugMarkdown bundled runtime dependency licenses",
    "",
    "This deterministic file is generated from the packages included in",
    "public/vendor/uartdebug-markdown.js. Do not edit it by hand.",
    "",
    ...sections,
    "",
  ].join("\n").replace(/\r\n/g, "\n");
}

async function readNormalized(path) {
  try {
    return (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  } catch {
    return "";
  }
}
