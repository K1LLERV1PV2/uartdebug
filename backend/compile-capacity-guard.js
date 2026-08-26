"use strict";

const { createCompileEnvelope } = require("./avr-compiler-contract");

function createCompileCapacityGuard({ maxConcurrent }) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new TypeError("maxConcurrent must be a positive integer.");
  }

  let activeRequests = 0;

  return function compileCapacityGuard(req, res, next) {
    if (activeRequests >= maxConcurrent) {
      res.setHeader("Retry-After", "1");
      return res.status(503).json(
        createCompileEnvelope({
          ok: false,
          stage: "server",
          code: "compiler_busy",
          stderr: "The compiler is busy. Try again shortly.",
        })
      );
    }

    activeRequests += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeRequests = Math.max(0, activeRequests - 1);
    };

    // A disconnected client does not necessarily stop XC8. Keep the slot until
    // the response finishes normally or the route explicitly reports that its
    // compiler work is complete.
    res.locals = res.locals || {};
    res.locals.releaseCompileCapacity = release;
    res.once("finish", release);
    return next();
  };
}

module.exports = { createCompileCapacityGuard };
