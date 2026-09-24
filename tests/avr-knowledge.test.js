"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadKnowledge, resolveKnowledge, validateProjectSpec, calculateTimerPeriod, calculateUsartBaud } = require("../backend/avr-knowledge");

const knowledge = loadKnowledge();
const baseSpec = () => ({ schemaVersion: 1, language: "es", description: "Indicador y puerto serie",
  microcontroller: { model: "ATtiny1624", package: "SOIC-14" }, clock: { hz: 20000000 },
  includes: ["xc.h", "stdint.h", "avr/interrupt.h"], resources: [] });
const uart = (changes = {}) => ({ id: "serial", kind: "uart", instance: "USART0", route: "DEFAULT",
  txPin: "PB2", rxPin: "PB3", baud: 115200, pin: null, direction: null,
  periodUs: null, prescaler: null, description: "Puerto serie", ...changes });
const timer = (changes = {}) => ({ id: "blink", kind: "timer", instance: "TCA0", pin: "PB0",
  periodUs: 500000, prescaler: 1024, direction: null, route: null, txPin: null,
  rxPin: null, baud: null, description: "Indicador", ...changes });
const errors = (spec) => validateProjectSpec(spec).errors.map((error) => error.code);

test("the pinned bundle contains only explicit device/package coverage and exact DFP routing", () => {
  assert.deepEqual(knowledge.devices.map(({ mcu, packages }) => ({ mcu, packages })), [
    { mcu: "ATtiny1624", packages: ["SOIC-14", "TSSOP-14"] },
    { mcu: "ATtiny1626", packages: ["SOIC-20", "SSOP-20", "VQFN-20"] },
    { mcu: "ATtiny1627", packages: ["VQFN-24"] },
  ]);
  const [tiny24, tiny26] = knowledge.devices;
  assert.equal(tiny24.memory.PROGMEM.bytes, 16384);
  assert.equal(tiny24.memory.INTERNAL_SRAM.bytes, 2048);
  assert.equal(tiny24.memory.EEPROM.bytes, 256);
  assert.equal(tiny24.pinouts["SOIC-14"].pins.PB2, 7);
  assert.equal(tiny24.uart.USART1.routes.ALT1, undefined);
  assert.equal(tiny26.uart.USART1.routes.ALT1.pins.txd, "PC2");
  assert.equal(tiny26.uart.USART1.routes.ALT1.pins.rxd, "PC1");
  assert.ok(tiny26.cSymbols.PORTMUX_USART1_ALT1_gc);
  assert.equal(tiny24.cSymbols.PORTMUX_USART1_ALT1_gc, undefined);
  assert.ok(tiny24.cSymbols.TCA_SINGLE_CLKSEL_DIV1024_gc);
  assert.ok(Object.isFrozen(knowledge.devices[0].uart));
});

test("curated HTML digests are local, hashed and distinguished from downloaded source bytes", () => {
  for (const document of knowledge.localDocuments) {
    assert.match(document.url, /^https:\/\/onlinedocs\.microchip\.com\//);
    assert.equal(document.sha256, crypto.createHash("sha256").update(document.text).digest("hex"));
    assert.equal(document.rawSourceSha256, null);
    const source = knowledge.sources.find((item) => item.id === document.sourceId);
    assert.equal(source.digestScope, "curated-local-digest-not-raw-html");
  }
  assert.equal(knowledge.sources.find((source) => source.id === "attiny162x-errata").verification, "revision-provenance-only");
  assert.equal(new Set(knowledge.recipes.flatMap((recipe) => recipe.lineage)).size, 10);
});

test("all pilot recipes are available independent of the user's language", () => {
  for (const requirements of ["Envía datos de temperatura por el puerto serie", "共有キャンバスから生成", "Передавать значения", ""]) {
    const result = resolveKnowledge({ mcu: "attiny1624", packageName: "soic14", requirements });
    assert.equal(result.supported, true);
    assert.equal(result.manifest.recipeIds.length, 7);
    assert.ok(result.manifest.recipeIds.includes("avr-uart-tx-interrupt"));
    assert.ok(result.context.length < 18000, "pilot context should stay bounded");
  }
  assert.ok(knowledge.recipes.every((recipe) => recipe.description.length > 15));
});

test("explicit selection adds dependencies, rejects unknown recipes and does not infer other AVR support", () => {
  const selective = resolveKnowledge({ mcu: "ATtiny1626", packageName: "VQFN20", recipeIds: ["avr-printf"] });
  assert.deepEqual(selective.manifest.recipeIds, ["avr-project", "avr-clock", "avr-uart-polling", "avr-printf"]);
  assert.equal(resolveKnowledge({ mcu: "ATmega328P", packageName: "DIP-28" }).supported, false);
  assert.equal(resolveKnowledge({ mcu: "ATtiny1624" }).supported, false);
  assert.equal(resolveKnowledge({ mcu: "ATtiny1624", packageName: "SOIC-14", recipeIds: ["adc"] }).supported, false);
  assert.equal(resolveKnowledge({ mcu: "ATtiny1624", packageName: "SOIC-14", recipeIds: "avr-gpio" }).supported, false);
});

test("normalizes nullable structured resources and plain include header names", () => {
  const spec = baseSpec();
  spec.resources = [uart(), timer()];
  spec.includes = ["xc.h", "avr/io.h", "<stdint.h>", '#include "avr/interrupt.h"'];
  const result = validateProjectSpec(spec);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.normalized.includes, ["xc.h", "avr/io.h", "stdint.h", "avr/interrupt.h"]);
  assert.equal(result.normalized.resources[0].pin, null);
  assert.ok(result.warnings.some((warning) => warning.code === "electrical_limits_not_validated"));
  assert.ok(resolveKnowledge({ requirements: spec }).context.includes('"per":9765'));
  assert.equal(resolveKnowledge({ mcu: "ATtiny1626", packageName: "SOIC-20", requirements: spec }).supported, false);
  for (const header of ["../secret.h", "/root/x.h", "avr//io.h", "<xc.h\"", "xc.h\n#include <evil.h>"]) {
    spec.includes = [header];
    assert.ok(errors(spec).includes("invalid_includes"), header);
  }
});

test("rejects unavailable pins, pin/peripheral conflicts and UPDI repurposing", () => {
  const spec = baseSpec();
  for (const pin of ["PC2", "PB7", "VCC"]) {
    spec.resources = [{ id: "led", kind: "gpio", direction: "output", pin }];
    assert.ok(errors(spec).includes("unavailable_pin"), pin);
  }
  spec.resources = [{ id: "led", kind: "gpio", direction: "output", pin: "PA0" }];
  assert.ok(errors(spec).includes("reserved_updi_pin"));
  spec.resources = [uart(), { id: "led", kind: "gpio", direction: "output", pin: "PB2" }];
  assert.ok(errors(spec).includes("pin_conflict"));
  spec.resources = [uart(), uart({ id: "other", txPin: null, rxPin: "PB3" })];
  assert.ok(errors(spec).includes("peripheral_conflict"));
  spec.resources = [timer(), timer({ id: "other", pin: null })];
  assert.ok(errors(spec).includes("peripheral_conflict"));
  spec.resources = [timer(), { id: "blink", kind: "gpio", direction: "output", pin: "PA4" }];
  assert.ok(errors(spec).includes("duplicate_resource_id"));
});

test("UART routing checks model differences as well as package pin presence", () => {
  const spec = baseSpec();
  spec.resources = [uart({ route: "ALT1" })];
  assert.ok(errors(spec).includes("uart_route_pin_mismatch"));
  spec.resources = [uart({ instance: "USART1", route: "ALT1", txPin: "PC2", rxPin: "PC1" })];
  assert.ok(errors(spec).includes("unsupported_uart_route"));
  spec.microcontroller = { model: "ATtiny1626", package: "VQFN-20" };
  assert.equal(validateProjectSpec(spec).valid, true);
  spec.resources[0].rxPin = null;
  assert.equal(validateProjectSpec(spec).valid, true, "TX-only route is supported");
  spec.resources[0].txPin = null;
  assert.ok(errors(spec).includes("missing_uart_pins"));
});

test("TCA timing avoids the legacy 20 MHz/500 ms intermediate overflow", () => {
  const value = calculateTimerPeriod({ clockHz: 20000000, periodUs: 500000, prescaler: 1024 });
  assert.equal(value.per, 9765);
  assert.equal(value.ticks, 9766);
  assert.equal(value.actualPeriodUs, 500019.2);
  assert.equal(value.prescalerSymbol, "TCA_SINGLE_CLKSEL_DIV1024_gc");
  assert.equal(calculateTimerPeriod({ clockHz: 1000000, periodUs: 65536, prescaler: 1 }).per, 65535);
  for (const options of [{ clockHz: 20000000, periodUs: 500000, prescaler: 1 }, { clockHz: 20000000, periodUs: 0, prescaler: 1024 }, { clockHz: 20000000, periodUs: 500000, prescaler: 32 }, { clockHz: 20000000, periodUs: Number.MAX_SAFE_INTEGER, prescaler: 1024 }]) assert.throws(() => calculateTimerPeriod(options), RangeError);
});

test("fractional USART baud calculation checks sample rate and register limits", () => {
  assert.equal(calculateUsartBaud({ clockHz: 20000000, baud: 115200 }).value, 694);
  assert.equal(calculateUsartBaud({ clockHz: 3333333, baud: 115200 }).value, 116);
  assert.equal(calculateUsartBaud({ clockHz: 20000000, baud: 2500000, samples: 8 }).value, 64);
  assert.throws(() => calculateUsartBaud({ clockHz: 20000000, baud: 2500000 }), RangeError);
  assert.throws(() => calculateUsartBaud({ clockHz: 20000000, baud: 1 }), RangeError);
  assert.throws(() => calculateUsartBaud({ clockHz: 20000000, baud: 0 }), RangeError);
});

test("unsupported clocks/peripherals are gaps, not silently accepted recipes", () => {
  const spec = baseSpec();
  spec.clock.hz = 16000000;
  assert.ok(errors(spec).includes("unsupported_clock_configuration"));
  spec.clock.hz = 24000000;
  assert.ok(errors(spec).includes("clock_out_of_range"));
  spec.clock.hz = 20000000;
  spec.resources = [{ id: "adc", kind: "adc", pin: "PA4" }];
  assert.ok(errors(spec).includes("unsupported_resource_kind"));
  spec.resources = [timer({ instance: "TCB0" })];
  assert.ok(errors(spec).includes("unsupported_timer"));
  spec.resources = [timer({ route: "PWM" })];
  assert.ok(errors(spec).includes("unsupported_resource_field"));
});

test("recorded compiler evidence is tied to exact fixture bytes, targets and service version", () => {
  const evidencePath = path.join(__dirname, "../backend/ai/knowledge/attiny162x/1.0.0/compiler-evidence.json");
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const fixture = fs.readFileSync(path.join(__dirname, "../scripts/avr-knowledge/fixtures", evidence.fixture));
  assert.equal(crypto.createHash("sha256").update(fixture).digest("hex"), evidence.sourceSha256);
  assert.deepEqual(evidence.runs.map((run) => run.mcu), ["attiny1624", "attiny1626", "attiny1627"]);
  assert.ok(evidence.runs.every((run) => run.ok && run.httpStatus === 200 && run.compileContract === "uartdebug-avr-compile/v1" && /^[a-f0-9]{64}$/.test(run.hexSha256)));
  assert.match(evidence.scope, /not hardware testing/);
  assert.equal(evidence.environmentObservation.installedDfpVersion, "3.3.272");
  for (const device of knowledge.devices) {
    const comparison = evidence.environmentObservation.selectedSymbolComparison[device.mcu];
    const publicSymbols = Object.keys(device.cSymbols).filter((name) => !name.endsWith("_gv"));
    assert.equal(publicSymbols.length, comparison.sharedSymbols);
    assert.equal(comparison.differentValues, 0);
    const context = resolveKnowledge({ mcu: device.mcu, packageName: device.packages[0] }).context;
    assert.ok(!context.includes("CLKCTRL_PDIV_6X_gv"), "unavailable new aliases must not leak into generation facts");
  }
});
