"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  createCompileCapacityGuard,
} = require("../backend/compile-capacity-guard");

test("compiler capacity guard holds disconnected work until route completion", () => {
  const guard = createCompileCapacityGuard({ maxConcurrent: 1 });
  const first = createResponse();
  const second = createResponse();
  const third = createResponse();
  let firstStarted = false;
  let thirdStarted = false;

  guard({}, first, () => {
    firstStarted = true;
  });
  guard({}, second, () => assert.fail("busy request must not start"));

  assert.equal(firstStarted, true);
  assert.equal(second.statusCode, 503);
  assert.equal(second.headers.get("Retry-After"), "1");
  assert.equal(second.body.code, "compiler_busy");
  assert.equal(second.body.stage, "server");

  first.emit("close");
  guard({}, third, () => assert.fail("disconnect must not release active work"));
  assert.equal(third.statusCode, 503);

  first.locals.releaseCompileCapacity();
  const afterCompletion = createResponse();
  guard({}, afterCompletion, () => {
    thirdStarted = true;
  });
  assert.equal(thirdStarted, true);
});

test("compiler capacity guard rejects invalid limits", () => {
  assert.throws(
    () => createCompileCapacityGuard({ maxConcurrent: 0 }),
    /positive integer/
  );
});

function createResponse() {
  const response = new EventEmitter();
  response.headers = new Map();
  response.statusCode = 200;
  response.body = null;
  response.setHeader = (name, value) => {
    response.headers.set(name, value);
  };
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    return response;
  };
  return response;
}
