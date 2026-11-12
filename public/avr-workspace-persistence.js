(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UartDebugWorkspacePersistence = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const KEY = "ud_avr_programming_state_v7";
  const LEGACY_KEYS = Object.freeze(["ud_avr_programming_state_v6", "ud_avr_programming_state_v5", "ud_avr_programming_state_v4", "ud_avr_programming_state_v3", "ud_avr_programming_state_v2"]);
  const CHECKPOINT_FIELD = "localCheckpoint";
  const validCheckpoint = value => typeof value === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(value);

  function createCheckpointId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if (!globalThis.crypto?.getRandomValues) throw new Error("Secure browser randomness is unavailable. Open the site over HTTPS or localhost.");
    return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function businessData(envelope) {
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new TypeError("Invalid saved workspace.");
    const { [CHECKPOINT_FIELD]: _checkpoint, ...data } = envelope;
    return data;
  }

  class OwnershipError extends Error {
    constructor() {
      super("Another tab changed the saved workspace. This copy must be reconciled before writing.");
      this.name = "WorkspaceOwnershipError";
      this.code = "workspace_ownership_changed";
    }
  }

  function create({ storage, key = KEY, legacyKeys = LEGACY_KEYS, createId } = {}) {
    if (!storage?.getItem || !storage?.setItem) throw new TypeError("Workspace storage is required.");
    const nextId = createId || createCheckpointId;
    let loaded = false, ownedRaw = null, sourceRaw = null, ownedData = null, checkpoint = null, migratedFrom = null;

    function readLegacy() {
      for (const legacyKey of legacyKeys) {
        const raw = storage.getItem(legacyKey);
        if (raw !== null) return { raw, key: legacyKey };
      }
      return { raw: null, key: null };
    }

    function load() {
      const current = storage.getItem(key);
      const source = current === null ? readLegacy() : { raw: current, key: null };
      const { raw } = source;
      migratedFrom = source.key;
      // A caller can preserve an unreadable envelope and replace it, but only
      // while this exact raw value still belongs to this tab.
      ownedRaw = current;
      sourceRaw = raw;
      ownedData = null;
      checkpoint = null;
      loaded = true;
      const envelope = raw === null ? null : JSON.parse(raw);
      const data = raw === null ? null : businessData(envelope);
      ownedRaw = current;
      ownedData = current === null ? null : JSON.stringify(data);
      const sourceCheckpoint = validCheckpoint(envelope?.[CHECKPOINT_FIELD]) ? envelope[CHECKPOINT_FIELD] : null;
      checkpoint = current === null ? null : sourceCheckpoint;
      return { data, raw, checkpoint, migratedFrom, sourceCheckpoint };
    }

    function owns(expectedCheckpoint = checkpoint) {
      if (!loaded) load();
      if (expectedCheckpoint !== checkpoint || storage.getItem(key) !== ownedRaw) return false;
      if (ownedRaw !== null) return true;
      const source = readLegacy();
      return source.key === migratedFrom && source.raw === sourceRaw;
    }

    function write(snapshot) {
      if (!loaded) load();
      // localStorage does not provide an atomic compare-and-swap. Fence every
      // observed ownership change and check again after committing; the cloud
      // separately retains its atomic revision-checked write contract.
      if (!owns()) throw new OwnershipError();
      const data = businessData(snapshot);
      const serialized = JSON.stringify(data);
      if (ownedRaw !== null && serialized === ownedData && checkpoint !== null) return { changed: false, checkpoint };
      const id = nextId();
      if (!validCheckpoint(id)) throw new TypeError("Invalid workspace checkpoint identity.");
      const raw = JSON.stringify({ ...data, [CHECKPOINT_FIELD]: id });
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw new OwnershipError();
      ownedRaw = raw;
      ownedData = serialized;
      checkpoint = id;
      return { changed: true, checkpoint };
    }

    return Object.freeze({ load, write, owns,
      get checkpoint() { return checkpoint; },
      get sourceRaw() { return sourceRaw; },
      get migratedFrom() { return migratedFrom; },
    });
  }

  return Object.freeze({ KEY, LEGACY_KEYS, CHECKPOINT_FIELD, businessData, OwnershipError, create, createId: createCheckpointId });
});
