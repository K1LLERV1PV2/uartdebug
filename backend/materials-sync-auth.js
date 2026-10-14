"use strict";

const crypto = require("node:crypto");

const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const REPOSITORY = "Sergey-Bulanov/UartDebug2";
const REPOSITORY_ID = "1408960831";
const OWNER_ID = "11813891";
const AUDIENCE = "https://uartdebug.com/api/internal/materials/sync";
const WORKFLOW = `${REPOSITORY}/.github/workflows/sync-ai-materials.yml@refs/heads/main`;

class MaterialsAuthenticationError extends Error {
  constructor() {
    super("A valid materials deployment identity is required.");
    this.code = "materials_identity_required";
    this.status = 401;
  }
}

function decodePart(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new MaterialsAuthenticationError();
  const value = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new MaterialsAuthenticationError();
  return value;
}

function createMaterialsIdentityVerifier({ fetch = globalThis.fetch, now = Date.now } = {}) {
  let cached = null;
  let loading = null;

  async function getKeys(refresh = false) {
    if (!refresh && cached && cached.expires > now()) return cached.keys;
    if (!loading) {
      loading = (async () => {
        const response = await fetch(JWKS_URL, {
          redirect: "error", signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new MaterialsAuthenticationError();
        const body = await response.text();
        if (Buffer.byteLength(body) > 128 * 1024) throw new MaterialsAuthenticationError();
        const keys = JSON.parse(body).keys;
        if (!Array.isArray(keys) || keys.length > 30) throw new MaterialsAuthenticationError();
        cached = { keys, expires: now() + 60 * 60 * 1000 };
        return keys;
      })().finally(() => { loading = null; });
    }
    return loading;
  }

  return async function verify(token) {
    try {
      if (typeof token !== "string" || token.length > 16384) throw new MaterialsAuthenticationError();
      const parts = token.split(".");
      if (parts.length !== 3) throw new MaterialsAuthenticationError();
      const header = decodePart(parts[0]);
      const claims = decodePart(parts[1]);
      const seconds = Math.floor(now() / 1000);
      const subjects = [
        `repo:${REPOSITORY}:ref:refs/heads/main`,
        `repo:Sergey-Bulanov@${OWNER_ID}/UartDebug2@${REPOSITORY_ID}:ref:refs/heads/main`,
      ];
      if (header.alg !== "RS256" || header.typ !== "JWT" || typeof header.kid !== "string" ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid) || header.jku || header.jwk || header.crit ||
          claims.iss !== ISSUER || claims.aud !== AUDIENCE || !subjects.includes(claims.sub) ||
          claims.repository !== REPOSITORY || claims.repository_id !== REPOSITORY_ID ||
          claims.repository_owner_id !== OWNER_ID || claims.repository_visibility !== "private" ||
          claims.ref !== "refs/heads/main" || claims.ref_type !== "branch" ||
          claims.workflow_ref !== WORKFLOW || claims.workflow_sha !== claims.sha ||
          !["push", "workflow_dispatch"].includes(claims.event_name) ||
          claims.runner_environment !== "github-hosted" ||
          !/^[a-f0-9]{40}$/.test(claims.sha || "") ||
          !/^[1-9][0-9]{0,19}$/.test(claims.run_id || "") ||
          !/^[1-9][0-9]{0,5}$/.test(claims.run_attempt || "") ||
          typeof claims.jti !== "string" || !claims.jti || claims.jti.length > 128 ||
          ![claims.iat, claims.nbf, claims.exp].every(Number.isSafeInteger) ||
          claims.exp <= seconds || claims.nbf > seconds + 30 || claims.iat > seconds + 30 ||
          seconds - claims.iat > 600 || claims.exp - claims.iat > 600 || claims.exp <= claims.iat) {
        throw new MaterialsAuthenticationError();
      }
      let keys = await getKeys();
      let key = keys.find((item) => item.kid === header.kid);
      if (!key) {
        keys = await getKeys(true);
        key = keys.find((item) => item.kid === header.kid);
      }
      if (!key || key.kty !== "RSA" || key.use !== "sig" || key.alg !== "RS256" ||
          !/^[A-Za-z0-9_-]+$/.test(parts[2]) ||
          !crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`),
            crypto.createPublicKey({ key, format: "jwk" }), Buffer.from(parts[2], "base64url"))) {
        throw new MaterialsAuthenticationError();
      }
      return { commit: claims.sha, runId: claims.run_id, runAttempt: claims.run_attempt, jti: claims.jti };
    } catch {
      throw new MaterialsAuthenticationError();
    }
  };
}

module.exports = { createMaterialsIdentityVerifier, MaterialsAuthenticationError, AUDIENCE, REPOSITORY };
