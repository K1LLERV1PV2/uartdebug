"use strict";

const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const runtime = require("./avr-ai-runtime");
const {
  AiServiceError,
  getRuntimeConfig,
  assertCompilerReady,
  verifyGeneratedProjectCompilation,
  mergeOpenAiMetering,
  beginProgressStage,
  finishProgressStage,
  emitProgressEvent,
  toPublicProgress,
  attachProgressToError,
  attachMeteringToError,
  attachUncertainProviderUsage,
  requestOpenAi,
  requestOpenAiInputTokenCount,
  extractOpenAiMetering,
  parseStructuredOutput,
  normalizeSafetyIdentifier,
  normalizeProviderIdentifier,
  timingSafeSecretEqual,
} = runtime;
const {
  CANVAS_OUTPUT_SCHEMA,
  CHAT_OUTPUT_SCHEMA,
  normalizeCanvas,
  validateCanvasOutput,
  projectIdentity,
  projectOutputNames,
  codeRegions,
  userCodeEditsRequested,
} = require("./avr-canvas-contract");
const { normalizeChatInput } = require("./avr-conversation-contract");
const {
  specificationText,
  normalizeProjectDocuments,
  inferLocale,
  isLocaleTag,
} = require("./avr-project-format");
const {
  PROJECT_STAGES,
  PROJECT_STAGE_NAMES,
  buildProjectPolicy,
  localizedMessage,
} = require("./avr-project-policy");
const { loadKnowledge, resolveKnowledge } = require("./avr-knowledge");
const {
  LOOKUP_TOOL,
  DOCUMENT_ROOTS,
  createDocumentationLookup,
} = require("./avr-documentation-lookup");
const {
  AVR_COMPILE_CONTRACT,
  AVR_COMPILE_SERVER_VERSION,
} = require("./avr-compiler-contract");
const { MAX_DOCUMENTATION_LOOKUPS } = require("./avr-ai-limits");
const CONTRACT = "uartdebug-project/v2";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function fail(status, code, message) {
  throw new AiServiceError(status, code, message);
}
function bounded(value, max, label, required = false) {
  if (value == null && !required) return "";
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    Buffer.byteLength(value) > max ||
    (required && !value.trim())
  )
    fail(400, "invalid_canvas_request", `${label} is invalid.`);
  return value.replace(/\r\n?/g, "\n");
}
function filename(value, extension) {
  const name = bounded(value, 96, "filename", true);
  if (
    /[\\/:*?"<>|\x00-\x1f]/.test(name) ||
    !extension.test(name) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ||
    /[ .]$/.test(name)
  )
    fail(400, "invalid_current_project", "Invalid project filename.");
  return name;
}
function projectDocuments(value) {
  try {
    return normalizeProjectDocuments(value);
  } catch (error) {
    fail(400, "invalid_current_project", error.message);
  }
}
function normalizeRequest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    fail(400, "invalid_canvas_request", "A project request is required.");
  let canvas;
  try {
    canvas = normalizeCanvas(raw.canvas);
  } catch (error) {
    throw new AiServiceError(
      error.status || 400,
      error.code || "invalid_canvas",
      error.message,
    );
  }
  const operation = raw.operation || "analyze";
  if (!Object.hasOwn(PROJECT_STAGES, operation))
    fail(
      400,
      "invalid_project_operation",
      "Choose analyze, generate or describe.",
    );
  const mcu = String(raw.mcu || canvas.target?.mcu || "")
    .trim()
    .toLowerCase();
  const packageName = String(
    raw.packageName || canvas.target?.packageName || "",
  ).trim();
  if (mcu && !/^[a-z0-9-]{2,32}$/.test(mcu))
    fail(400, "invalid_mcu", "Invalid MCU target.");
  if (packageName && !/^[A-Za-z0-9-]{2,32}$/.test(packageName))
    fail(400, "invalid_package", "Invalid package.");
  if (canvas.target?.mcu && canvas.target.mcu.toLowerCase() !== mcu)
    fail(
      400,
      "canvas_target_mismatch",
      "The project target changed. Reload before processing.",
    );
  if (
    canvas.target?.packageName &&
    canvas.target.packageName.toLowerCase() !== packageName.toLowerCase()
  )
    fail(
      400,
      "canvas_target_mismatch",
      "The project package changed. Reload before processing.",
    );
  canvas.target = { mcu, packageName };
  let currentProject = null;
  if (raw.currentProject != null) {
    const project = raw.currentProject;
    if (
      !project ||
      typeof project !== "object" ||
      Array.isArray(project) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(project.instanceId || "")
    )
      fail(
        400,
        "invalid_current_project",
        "An editable project instance is required.",
      );
    currentProject = {
      instanceId: project.instanceId,
      id: bounded(project.id, 128, "project id"),
      title: bounded(project.title, 96, "project title"),
      version: bounded(project.version, 32, "project version"),
      canvasName: bounded(project.canvasName, 96, "specification filename"),
      projectPath: bounded(project.projectPath, 256, "project path"),
      projectDocuments: projectDocuments(project.projectDocuments),
      sourceName: filename(project.sourceName || "project.c", /\.c$/i),
      guideName: filename(
        project.guideName || "project Code Description.md",
        /\.md$/i,
      ),
      source: bounded(project.source, 64 * 1024, "current source"),
      guide: bounded(project.guide, 128 * 1024, "current description"),
      guideLocale: bounded(
        project.guideLocale,
        35,
        "current description locale",
      ),
    };
    if (
      currentProject.guideLocale &&
      !isLocaleTag(currentProject.guideLocale)
    ) {
      fail(400, "invalid_current_project", "Invalid description language.");
    }
    if (!currentProject.guideLocale && currentProject.guide.trim())
      currentProject.guideLocale = inferLocale(currentProject.guide, "und");
    if (project.specification)
      currentProject.specification = {
        name: filename(project.specification.name, /\.ya?ml$/i),
        content: bounded(
          project.specification.content,
          128 * 1024,
          "current resources",
        ),
      };
  }
  return { operation, canvas, mcu, packageName, currentProject };
}
function normalizeChatRequest(raw) {
  let conversation;
  try {
    conversation = normalizeChatInput(raw);
  } catch (error) {
    fail(400, "invalid_chat_request", error.message);
  }
  return {
    ...normalizeRequest({ ...raw, operation: "analyze" }),
    operation: "chat",
    ...conversation,
  };
}
function specificationTarget(markdown, devices) {
  const hardware =
    /^##\s+(?:Требования к аппаратной части|Аппаратные требования|Hardware requirements|Requisitos de hardware|Exigences matérielles|Hardwareanforderungen)\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im.exec(
      specificationText(markdown),
    )?.[1] || "";
  const text = hardware;
  const models = [
    ...new Set(
      (text.match(/\bAT(?:tiny|mega)\d+[A-Za-z0-9-]*\b/gi) || []).map((value) =>
        value.toLowerCase(),
      ),
    ),
  ];
  const packageNames = [
    ...new Set(devices.flatMap((device) => device.packages)),
  ];
  const packages = [...new Set([
    ...packageNames.filter((name) =>
      new RegExp(`\\b${name.replace("-", "[- ]?")}\\b`, "i").test(text),
    ),
    ...(text.match(/\b(?:SOIC|TSSOP|SSOP|V?QFN|TQFP|QFP|P?DIP)[- ]?\d+\b/gi) || [])
      .map((name) => name.toUpperCase().replace(/[- ]?(\d+)$/, "-$1")),
  ])];
  return {
    mcu: models.length === 1 ? models[0] : "",
    packageName: packages.length === 1 ? packages[0] : "",
    ambiguous: models.length > 1 || packages.length > 1,
  };
}
function canvasResult(input, message) {
  return {
    ok: true,
    kind: "canvas",
    stage: input.operation,
    message,
    baseRevision: input.canvas.revision,
    canvas: {
      ...input.canvas,
      revision: input.canvas.revision + 1,
      annotations: [],
    },
  };
}
function publicProject(project, input, manifest, randomUUID) {
  const files = [];
  if (project.source)
    files.push({ role: "source", ...project.source, mediaType: "text/x-c" });
  if (project.guide)
    files.push({
      role: "guide",
      ...project.guide,
      mediaType: "text/markdown",
      default: true,
      label: project.guide.locale,
      hidden: true,
    });
  if (project.resources)
    files.push({
      role: "specification",
      ...project.resources,
      mediaType: "application/yaml",
      hidden: true,
    });
  return {
    schemaVersion: 1,
    id: input.currentProject?.id || `generated-${randomUUID()}`,
    displayName: project.title,
    title: project.title,
    summary: project.summary,
    version: project.version,
    defaultLocale: project.guide?.locale || input.canvas.locale || "en",
    canvasName:
      input.currentProject?.id === "empty-project" && !input.currentProject.source.trim()
        ? `${project.title}.md`
        : input.currentProject?.canvasName || `${project.title}.md`,
    projectPath: `Target_Projects/${project.title} ${project.version}`,
    specificationMarkdown: input.canvas.markdown,
    projectDocuments: input.currentProject?.projectDocuments || [],
    files,
    knowledge: manifest,
  };
}
function createAvrAiService(options = {}) {
  const environment = options.environment || process.env;
  const fetchImpl = options.fetch || globalThis.fetch;
  const compileFetchImpl = options.compileFetch || globalThis.fetch;
  const compileHealthFetchImpl = options.compileHealthFetch || compileFetchImpl;
  const knowledgeLoader =
    options.loadKnowledge ||
    (() =>
      loadKnowledge({
        root: options.materialsRoot || environment.AI_MATERIALS_ROOT,
      }));
  const knowledgeResolver = options.resolveKnowledge || resolveKnowledge;
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const cacheRoot = String(
    environment.AI_DOCUMENTATION_CACHE_DIR ||
      path.join(os.tmpdir(), "uartdebug-documentation-cache"),
  );
  function config() {
    return {
      ...getRuntimeConfig(environment),
      externalDocumentationEnabled:
        environment.AI_EXTERNAL_DOCUMENTATION_ENABLED === "1",
    };
  }
  function rules(knowledge, conversation = false) {
    const documents = knowledge.initialRules || [];
    if (
      documents.length !== 4 ||
      documents.some((document) => !document.text?.trim())
    )
      fail(
        503,
        "materials_rules_unavailable",
        "The canonical project rules are unavailable.",
      );
    const sources = documents.map((document) =>
      `Repository project rules (${document.path}):\n${document.text}`,
    ).join("\n\n");
    const policies = [buildProjectPolicy(), buildProjectPolicy({ conversation: true })];
    const policy = policies[conversation ? 1 : 0];
    return {
      packageId: `UartDebug2@${knowledge.version}`,
      digest: hash(`${sources}\n\n${policies.join("\n\n")}`),
      sources,
      policy,
    };
  }
  async function getStatus() {
    const cfg = config();
    let knowledge = null,
      knowledgeError = null,
      ruleData = null,
      compilerError = null;
    try {
      const data = await knowledgeLoader();
      ruleData = rules(data);
      knowledge = {
        id: data.id || "UartDebug2",
        version: data.version,
        digest: hash(
          JSON.stringify(data.manifest || data.sourceManifest || {}),
        ),
        repository: data.repository,
        devices: data.devices.map((device) => ({
          mcu: device.mcu,
          packages: device.packages,
        })),
        referenceDocuments: data.referenceCatalog || [],
        methodology: [],
        sourceManifest: data.sourceManifest,
      };
    } catch {
      knowledgeError = "materials_unavailable";
    }
    let compilerReady = !cfg.compileVerificationEnabled;
    if (cfg.enabled && cfg.configured && cfg.compileVerificationEnabled) {
      try {
        await assertCompilerReady({
          compileFetchImpl: compileHealthFetchImpl,
          healthUrl: cfg.compileHealthUrl,
          timeoutMs: cfg.compileHealthTimeoutMs,
        });
        compilerReady = true;
      } catch (error) {
        compilerError = error.code || "compiler_unavailable";
      }
    }
    return {
      ok: true,
      contract: CONTRACT,
      stages: PROJECT_STAGE_NAMES,
      enabled: cfg.enabled,
      configured: cfg.configured,
      accessRequired: cfg.requireAccessToken,
      accessConfigured: cfg.accessConfigured,
      ready:
        cfg.enabled &&
        cfg.configured &&
        (!cfg.requireAccessToken || cfg.accessConfigured) &&
        !!knowledge &&
        !!ruleData,
      model: cfg.model,
      rules: ruleData
        ? { packageId: ruleData.packageId, digest: ruleData.digest }
        : null,
      rulesError: knowledgeError,
      knowledge,
      knowledgeError,
      externalDocumentation: {
        enabled: cfg.externalDocumentationEnabled,
        maxRequests: 2,
        domains: ["onlinedocs.microchip.com"],
        requiresLocalLookup: true,
      },
      compilerVerification: {
        enabled: cfg.compileVerificationEnabled,
        ready: compilerReady,
        error: compilerError,
        maxRepairAttempts: cfg.compileRepairAttempts,
        contract: AVR_COMPILE_CONTRACT,
        contractVersion: AVR_COMPILE_SERVER_VERSION,
      },
    };
  }
  async function processProject(raw, context = {}, conversation = false) {
    const cfg = config();
    if (!cfg.enabled)
      fail(503, "ai_disabled", "The AI assistant is currently disabled.");
    if (!cfg.configured)
      fail(
        503,
        "api_key_not_configured",
        "The OpenAI API key is not configured on the server.",
      );
    const input = conversation ? normalizeChatRequest(raw) : normalizeRequest(raw);
    const explicitTarget = { mcu: input.mcu, packageName: input.packageName };
    const knowledge = await knowledgeLoader();
    const language = input.canvas.locale || inferLocale(specificationText(input.canvas.markdown), "en");
    const clarify = (key) => canvasResult(input, localizedMessage(key, language));
    if (
      !conversation && input.operation !== "analyze" &&
      !projectIdentity(input.canvas.markdown)
    )
      return clarify("identity");
    if (input.operation === "describe" && !input.currentProject?.source?.trim())
      return clarify("source");
    if (input.operation === "generate") {
      const specified = specificationTarget(
        input.canvas.markdown,
        knowledge.devices,
      );
      if (specified.ambiguous) return clarify("targetAmbiguous");
      if (
        (specified.mcu && input.mcu && specified.mcu !== input.mcu) ||
        (specified.packageName &&
          input.packageName &&
          specified.packageName.toLowerCase() !==
            input.packageName.toLowerCase())
      )
        return clarify("targetConflict");
      input.mcu ||= specified.mcu;
      input.packageName ||= specified.packageName;
      input.canvas.target = { mcu: input.mcu, packageName: input.packageName };
      try {
        projectOutputNames(
          input.canvas.markdown,
          projectIdentity(input.canvas.markdown),
          input.currentProject,
        );
      } catch {
        return clarify("outputNames");
      }
      if (input.currentProject?.source?.trim()) {
        try {
          const regions = codeRegions(input.currentProject.source);
          if (
            regions.filter((region) => region.user).length < 3 ||
            regions.filter((region) => !region.user).length < 4
          )
            return clarify("damagedMarkers");
          if (userCodeEditsRequested(input.currentProject.source))
            return clarify("userRegions");
        } catch {
          return clarify("damagedMarkers");
        }
      }
    }
    if (input.operation === "generate" && (!input.mcu || !input.packageName))
      return clarify("targetMissing");
    if (conversation) {
      const specified = specificationTarget(input.canvas.markdown, knowledge.devices);
      const mentioned = specificationTarget(`## Hardware requirements\n${input.message}`, knowledge.devices);
      if (!specified.ambiguous) {
        input.mcu ||= (!mentioned.ambiguous ? mentioned.mcu : "") || specified.mcu;
        input.packageName ||= (!mentioned.ambiguous ? mentioned.packageName : "") || specified.packageName;
        input.canvas.target = { mcu: input.mcu, packageName: input.packageName };
      }
    }
    const selected =
      input.mcu && input.packageName
        ? await knowledgeResolver({
            mcu: input.mcu,
            packageName: input.packageName,
            knowledge,
          })
        : {
            supported: false,
            context: (knowledge.initialKnowledge || [])
              .map(
                (document) =>
                  `Local knowledge pointer (${document.path}):\n${document.text}`,
              )
              .join("\n\n"),
            manifest: {
              id: "UartDebug2",
              version: knowledge.version,
              repository: knowledge.repository,
            },
          };
    if (input.operation === "generate" && !selected.supported)
      return clarify("targetUnsupported");
    if (
      input.operation === "generate" &&
      cfg.compileVerificationEnabled &&
      context.compilerReady !== true
    )
      await assertCompilerReady({
        compileFetchImpl: compileHealthFetchImpl,
        healthUrl: cfg.compileHealthUrl,
        timeoutMs: cfg.compileHealthTimeoutMs,
      });
    const ruleData = rules(knowledge, conversation);
    const lookup = createDocumentationLookup({
      knowledge,
      fetch: options.documentationFetch || globalThis.fetch,
      cacheRoot,
      corpus: knowledge.corpus,
      reviewedFacts: knowledge.reviewedFacts,
      dfpRegisters: knowledge.dfpRegisters,
      mcu: input.mcu,
      enabled: cfg.externalDocumentationEnabled,
    });
    let request = {
      model: cfg.model,
      store: false,
      reasoning: { effort: cfg.reasoningEffort },
      max_output_tokens: cfg.maxOutputTokens,
      instructions: [
        ruleData.sources,
        "Available local knowledge:\n" + selected.context,
        "Registered official document roots: " + DOCUMENT_ROOTS.join(" "),
        `At most ${MAX_DOCUMENTATION_LOOKUPS} local documentation steps and two external network requests are allowed. Follow required section continuations within this limit.`,
        ruleData.policy,
        conversation
          ? "This is a chat request. Select reply, clarify (specification), generate, or describe from the latest message under the integration policy. The supplied artifacts are the current state; do not restore old versions from conversation history."
          : `Selected stage: ${input.operation}. ${JSON.stringify(PROJECT_STAGES[input.operation])}`,
      ].join("\n\n"),
      input: conversation
        ? [...input.history, { role: "user", content: JSON.stringify({ ...input, history: undefined }) }]
        : [{ role: "user", content: JSON.stringify(input) }],
      tools: [LOOKUP_TOOL],
      tool_choice: "auto",
      parallel_tool_calls: false,
      text: {
        format: {
          type: "json_schema",
          name: conversation ? "uartdebug_conversation" : "uartdebug_project",
          strict: true,
          schema: conversation ? CHAT_OUTPUT_SCHEMA : CANVAS_OUTPUT_SCHEMA,
        },
      },
    };
    const safety =
      normalizeSafetyIdentifier(context.safetyIdentifier) ||
      cfg.safetyIdentifier;
    if (safety) request.safety_identifier = safety;
    const requestId = normalizeProviderIdentifier(context.requestId, 64);
    if (requestId) request.metadata = { uartdebug_request_id: requestId };
    let metering = null,
      calls = 0,
      compileAttempts = 0,
      repairAttempts = 0,
      lookups = 0,
      mustGenerateAfterRepair = false,
      nextStep = input.operation,
      previousErrorCode = null;
    let repairCanvas = null;
    const stages = [],
      references = [];
    async function callModel(body, stageId) {
      body.max_output_tokens = cfg.maxOutputTokens;
      const metered = typeof context.reserveBudget === "function";
      if (metered) {
        const tokens = await requestOpenAiInputTokenCount({
          fetchImpl,
          apiKey: cfg.apiKey,
          timeoutMs: cfg.timeoutMs,
          requestBody: body,
        });
        if (calls && typeof context.extendBudget !== "function")
          fail(
            503,
            "ai_budget_extension_unavailable",
            "The AI budget cannot authorize another step.",
          );
        const quote = calls
          ? await context.extendBudget({
              model: cfg.model,
              additionalInputTokens: tokens,
              additionalMaxOutputTokens: body.max_output_tokens,
              minAdditionalOutputTokens: cfg.minMeteredOutputTokens,
              completedMetering: metering,
            })
          : await context.reserveBudget({
              model: cfg.model,
              inputTokens: tokens,
              maxOutputTokens: body.max_output_tokens,
              minOutputTokens: cfg.minMeteredOutputTokens,
            });
        const allowed = Number(
          calls ? quote?.additionalMaxOutputTokens : quote?.maxOutputTokens,
        );
        if (
          !Number.isSafeInteger(allowed) ||
          allowed < cfg.minMeteredOutputTokens ||
          allowed > body.max_output_tokens
        )
          fail(500, "ai_reservation_invalid", "Invalid AI budget reservation.");
        body.max_output_tokens = allowed;
      }
      const stage = await beginProgressStage(context, stages, {
        id: stageId,
        attempt: calls + 1,
        label: stageId === "repair" ? nextStep === "compiler-repair" ? "Repairing compiler errors" : "Correcting the response after validation"
          : conversation ? "Analyzing the request" : input.operation === "generate" ? "Generating project code and resources"
            : input.operation === "describe" ? "Writing code documentation" : "Reviewing the specification",
      });
      let started = false,
        captured = false,
        streamedAction = null;
      try {
        await context.markProviderCalled?.();
        started = true;
        calls++;
        const response = await requestOpenAi({
          fetchImpl,
          apiKey: cfg.apiKey,
          timeoutMs: cfg.timeoutMs,
          requestBody: body,
          ...(conversation && typeof context.onMessageDelta === "function" ? {
            onMessageDelta: context.onMessageDelta,
            onMessageReset: context.onMessageReset,
            resetAtStart: stageId === "repair",
            async onAction(action) {
              streamedAction = action;
              if (stageId === "repair") return;
              stage.label = { reply: "Writing a response", clarify: "Reviewing the specification",
                generate: "Generating project code and resources", describe: "Writing code documentation" }[action];
              await emitProgressEvent(context, { ...stage });
            },
          } : {}),
        });
        const usage = extractOpenAiMetering(response, cfg.model, {
          strict: metered,
        });
        metering = mergeOpenAiMetering(metering, usage);
        captured = true;
        const stopped = response?.status === "failed" || response?.status === "incomplete";
        await finishProgressStage(context, stage, stopped ? "failed" : "completed", {
          label: stopped ? "Response generation stopped"
            : (response?.output || []).some(item => item.type === "function_call") ? stageId === "repair" ? "Repair step prepared a tool request" : "Prepared a tool request"
              : stageId === "repair" ? nextStep === "compiler-repair" ? "Compiler repair draft prepared" : "Corrected response draft prepared"
              : ({ reply: "Response draft written", clarify: "Specification draft reviewed", generate: "Project draft generated",
                describe: "Documentation draft written" }[streamedAction] || "Response draft prepared"),
        });
        return response;
      } catch (e) {
        if (started && !captured && e._providerRejected !== true)
          attachUncertainProviderUsage(e);
        await finishProgressStage(context, stage, "failed", {
          errorCode: e.code || "generation_failed",
        });
        throw e;
      }
    }
    try {
      while (true) {
        const response = await callModel(
          request,
          repairAttempts ? "repair" : "generation",
        );
        const toolCalls = (response.output || []).filter(
          (item) => item.type === "function_call",
        );
        if (toolCalls.length) {
          if (
            toolCalls.length !== 1 ||
            toolCalls[0].name !== LOOKUP_TOOL.name ||
            lookups >= MAX_DOCUMENTATION_LOOKUPS
          )
            fail(
              502,
              "documentation_limit_reached",
              "The documentation lookup limit was reached. Narrow the requirements.",
            );
          const call = toolCalls[0];
          let args;
          try {
            args = JSON.parse(call.arguments);
          } catch {
            fail(
              502,
              "invalid_documentation_request",
              "Invalid documentation lookup arguments.",
            );
          }
          const stage = await beginProgressStage(context, stages, {
            id: "documentation",
            attempt: lookups + 1,
            label: { catalog: "Browsing local documentation", search: "Searching local project documentation",
              read: "Reading local documentation", registers: "Checking local device registers",
              external: "Reading official Microchip documentation" }[args.operation] || "Reading documentation",
          });
          const result = await lookup.lookup(args);
          lookups++;
          await finishProgressStage(
            context,
            stage,
            result.ok ? "completed" : "failed",
            result.ok ? { label: { catalog: "Local documentation index loaded", search: "Local documentation search completed",
              read: "Local documentation read", registers: "Local device register definitions checked",
              external: "Official Microchip documentation read" }[args.operation] || "Documentation loaded" }
              : { errorCode: result.code, label: "Documentation lookup did not complete" },
          );
          if (result.ok && result.operation !== "catalog") {
            const items =
              result.operation === "registers"
                ? [result]
                : [
                    ...(result.results || [result]),
                    ...(result.materialResults || []),
                  ];
            for (const item of items) {
              const reference = {
                url: item.sourceUrl || item.url,
                title:
                  item.title ||
                  (item.mcu
                    ? `${item.mcu} DFP register definitions`
                    : undefined),
                sourceId: item.sourceId,
                documentId: item.documentId,
                revision: item.revision,
                page: item.page,
                sectionIds: item.sectionIds,
                sha256: item.sha256,
                origin: result.origin,
                digestScope: item.digestScope,
                verification:
                  item.verification || result.verification || "source-only",
                reviewStatus: item.reviewStatus,
                atdfMember: item.atdfMember,
                atdfSha256: item.atdfSha256,
                startLine: item.startLine,
                endLine: item.endLine,
                sectionTitle: item.sectionTitle,
                kind: item.kind,
              };
              if (
                !references.some(
                  (previous) =>
                    JSON.stringify(previous) === JSON.stringify(reference),
                )
              )
                references.push(reference);
            }
          }
          request = {
            ...request,
            input: [
              ...request.input,
              ...response.output,
              {
                type: "function_call_output",
                call_id: call.call_id,
                output: JSON.stringify(result),
              },
            ],
            tools: lookups < MAX_DOCUMENTATION_LOOKUPS ? [LOOKUP_TOOL] : [],
            tool_choice: lookups < MAX_DOCUMENTATION_LOOKUPS ? "auto" : "none",
          };
          nextStep = "documentation-continuation";
          previousErrorCode = result.ok ? null : result.code;
          continue;
        }
        let output;
        let outputOperation = input.operation;
        let outputInput = input;
        let outputKnowledge = selected;
        const validationStage = await beginProgressStage(context, stages, { id: "validation", attempt: calls });
        try {
          const parsed = parseStructuredOutput(response);
          if (conversation) {
            outputOperation = { reply: "chat", clarify: "analyze", generate: "generate", describe: "describe" }[parsed?.action];
            if (input.requestSource === "review" && ["generate", "describe"].includes(outputOperation))
              fail(502, "invalid_generated_canvas", "The Review specification shortcut cannot change code, resources or descriptions. Reply in the chat or review the specification only.");
            if (outputOperation === "generate") {
              const specified = specificationTarget(parsed.canvas?.markdown || input.canvas.markdown, knowledge.devices);
              const mcu = explicitTarget.mcu || specified.mcu || input.mcu;
              const packageName = explicitTarget.packageName || specified.packageName || input.packageName;
              if (!mcu || !packageName || specified.ambiguous ||
                  (specified.mcu && specified.mcu !== mcu) ||
                  (specified.packageName && specified.packageName.toLowerCase() !== packageName.toLowerCase())) {
                fail(502, "invalid_generated_canvas", "Code generation requires one supported, consistent microcontroller and package. Ask for the missing target in the chat.");
              }
              outputKnowledge = mcu === input.mcu && packageName === input.packageName ? selected :
                await knowledgeResolver({ mcu, packageName, knowledge });
              if (!outputKnowledge.supported)
                fail(502, "invalid_generated_canvas", "The generated project needs applicable canonical local materials for its microcontroller and package.");
              outputInput = { ...input, mcu, packageName, canvas: { ...input.canvas, target: { mcu, packageName } } };
              if (input.currentProject?.source && userCodeEditsRequested(input.currentProject.source)) {
                fail(502, "invalid_generated_canvas", "Protected user code contains pending instructions. Explain that these regions must be edited manually.");
              }
            }
          }
          if (repairCanvas && (parsed.canvas?.markdown !== repairCanvas.markdown || parsed.canvas?.locale !== repairCanvas.locale))
            fail(502, "invalid_ai_repair_response", "Compiler repair must preserve the validated specification exactly.");
          output = validateCanvasOutput(parsed, {
            ...outputInput,
            operation: outputOperation,
            conversation,
            device:
              outputOperation === "generate"
                ? knowledge.devices.find(
                    (device) => device.mcu.toLowerCase() === outputInput.mcu,
                  )
                : undefined,
          });
          await finishProgressStage(context, validationStage, "completed", {
            label: { chat: "Response checked", analyze: "Specification checked", generate: "Project format and resources checked",
              describe: "Description checked" }[outputOperation] || "Response checked",
          });
          if (output.action === "reply") {
            if (mustGenerateAfterRepair)
              fail(502, "invalid_ai_repair_response", "Compiler repair must return complete C and resource YAML.");
            return {
              ok: true, kind: "chat", stage: "chat", message: output.message,
              baseRevision: input.canvas.revision,
              knowledge: selected.manifest,
              references,
              progress: toPublicProgress(stages, "completed"),
              _metering: metering,
            };
          }
          if (output.action === "clarify") {
            if (mustGenerateAfterRepair)
              fail(
                502,
                "invalid_ai_repair_response",
                "Compiler repair must return complete C and resource YAML.",
              );
            return {
              ...canvasResult({ ...outputInput, operation: outputOperation }, output.message),
              canvas: {
                ...output.canvas,
                revision: input.canvas.revision + 1,
                target: outputInput.canvas.target,
              },
              knowledge: outputKnowledge.manifest,
              references,
              progress: toPublicProgress(stages, "completed"),
              _metering: metering,
            };
          }
        } catch (error) {
          await finishProgressStage(context, validationStage, "failed", { errorCode: error.code || "invalid_ai_response" });
          if (
            [
              "ai_refusal",
              "ai_content_filtered",
              "ai_output_limit_reached",
              "ai_response_failed",
            ].includes(error.code) ||
            repairAttempts >= cfg.compileRepairAttempts
          )
            throw error;
          repairAttempts++;
          nextStep = "validation-repair";
          previousErrorCode = error.code || "invalid_ai_response";
          request = {
            ...request,
            input: [
              ...request.input,
              ...(response.output || []),
              {
                role: "user",
                content: JSON.stringify({
                  repairAttempt: repairAttempts,
                  validationError: { code: error.code, message: error.message },
                  instruction:
                    conversation
                      ? "Correct this response within the latest user's authorized request. A generate response may create or update the specification for that same requested work; preserve unrelated requirements and every user C region. A describe response preserves the specification exactly. If a required decision is missing, return reply with canvas null/project null and ask in the chat. Do not create new inline question blocks."
                      : "Correct this response within the same authorized project stage. Preserve the input specification during generate/describe and preserve every user C region. Return clarify if a required decision is missing.",
                }),
              },
            ],
            tools: [],
            tool_choice: "none",
          };
          continue;
        }
        let compilation = { ok: true };
        if (outputOperation === "generate" && cfg.compileVerificationEnabled) {
          if (conversation && context.compilerReady !== true)
            await assertCompilerReady({
              compileFetchImpl: compileHealthFetchImpl,
              healthUrl: cfg.compileHealthUrl,
              timeoutMs: cfg.compileHealthTimeoutMs,
            });
          compileAttempts++;
          nextStep = "compilation";
          previousErrorCode = null;
          const stage = await beginProgressStage(context, stages, {
            id: "compilation",
            attempt: compileAttempts,
            mcu: outputInput.mcu,
            label: `Compiling for ${outputInput.mcu}`,
          });
          try {
            compilation = await verifyGeneratedProjectCompilation({
              compileFetchImpl,
              compileUrl: cfg.compileUrl,
              timeoutMs: cfg.compileTimeoutMs,
              generated: output.project,
              mcu: outputInput.mcu,
            });
          } catch (error) {
            await finishProgressStage(context, stage, "failed", {
              errorCode: error.code || "compiler_unavailable",
            });
            throw error;
          }
          await finishProgressStage(
            context,
            stage,
            compilation.ok ? "completed" : "failed",
            { label: compilation.ok ? "Compilation completed successfully" : "Compiler reported errors",
              ...(compilation.compilerStage ? { compilerStage: compilation.compilerStage } : {}) },
          );
        }
        if (!compilation.ok) {
          if (repairAttempts >= cfg.compileRepairAttempts)
            fail(
              422,
              "generated_project_does_not_compile",
              "The project did not compile after automatic repair.",
            );
          repairAttempts++;
          nextStep = "compiler-repair";
          previousErrorCode = "generated_project_does_not_compile";
          mustGenerateAfterRepair = true;
          repairCanvas = output.canvas;
          request = {
            ...request,
            input: [
              ...request.input,
              ...(response.output || []),
              {
                role: "user",
                content: JSON.stringify({
                  repairAttempt: repairAttempts,
                  compilerDiagnostics: compilation.diagnostics,
                  specification: output.canvas,
                  instruction:
                    "Repair only the C and resource YAML. Preserve the exact validated specification supplied here and user C regions. Return generate for the same project identity and selected target.",
                }),
              },
            ],
            tools: [],
            tool_choice: "none",
          };
          continue;
        }
        return {
          ok: true,
          kind: "project",
          stage: outputOperation,
          operation: input.currentProject ? "update" : "create",
          targetInstanceId: input.currentProject?.instanceId || null,
          message: output.message,
          baseRevision: input.canvas.revision,
          canvas: {
            ...output.canvas,
            revision: input.canvas.revision + 1,
            target: outputInput.canvas.target,
          },
          project: publicProject(
            output.project,
            { ...outputInput, canvas: output.canvas },
            outputKnowledge.manifest,
            randomUUID,
          ),
          knowledge: outputKnowledge.manifest,
          references,
          verification: {
            schemaVersion: 1,
            status:
              outputOperation === "generate"
                ? cfg.compileVerificationEnabled
                  ? "passed"
                  : "skipped"
                : "not-requested",
            resources:
              outputOperation === "generate" ? "passed" : "not-requested",
            mcu: outputInput.mcu,
            packageName: outputInput.packageName,
            compileAttempts,
            repairAttempts,
            hardware: "not-tested",
          },
          progress: toPublicProgress(stages, "completed"),
          _metering: metering,
        };
      }
    } catch (e) {
      let error = e;
      if (
        !(error instanceof AiServiceError) &&
        Number.isInteger(e.status) &&
        e.code
      )
        error = new AiServiceError(e.status, e.code, e.message);
      if (e._usageUncertain) attachUncertainProviderUsage(error);
      Object.defineProperty(error, "diagnostic", {
        value: {
          stage: nextStep,
          causeCode: previousErrorCode,
          providerCalls: calls,
          documentationLookups: lookups,
          repairAttempts,
          compileAttempts,
        },
        enumerable: false,
      });
      throw attachMeteringToError(
        attachProgressToError(error, stages),
        metering,
      );
    }
  }
  return {
    processCanvas(raw, context) { return processProject(raw, context); },
    processChat(raw, context) { return processProject(raw, context, true); },
    getStatus,
    getRuntimeConfig: config,
    authorizeAccessToken(token) {
      const cfg = config();
      return (
        !cfg.requireAccessToken || timingSafeSecretEqual(cfg.accessToken, token)
      );
    },
    validateRequestInput(raw) {
      normalizeRequest(raw);
      return true;
    },
    validateChatRequestInput(raw) {
      normalizeChatRequest(raw);
      return true;
    },
  };
}
module.exports = {
  AiServiceError,
  createAvrAiService,
  normalizeRequest,
  normalizeChatRequest,
  CONTRACT,
  extractOpenAiMetering,
};
