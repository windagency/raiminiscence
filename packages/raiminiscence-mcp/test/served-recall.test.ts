import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "#src/core/embeddings/provider.js";
import { PACKAGE_VERSION } from "#src/core/package-version.js";
import { recall } from "#src/core/recall.js";
import { requestServedRecall, type RecallServer } from "#src/core/recall-socket.js";
import { remember } from "#src/core/remember.js";
import { serveRecall } from "#src/core/served-recall.js";

const isWindows = process.platform === "win32";

/** A tiny bag-of-words provider: identical for the server and the caller, and deterministic. */
const provider: EmbeddingProvider = {
  identity: { provider: "stub", model: "bag-of-words" },
  async embed(text: string) {
    const words = ["kafka", "lag", "postgres", "retry"];
    const lower = text.toLowerCase();
    return words.map((word) => (lower.includes(word) ? 1 : 0.01));
  },
};

describe.skipIf(isWindows)("serveRecall (ADR-0039)", () => {
  let dir: string;
  let storageRoot: string;
  let socketPath: string;
  let server: RecallServer | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "rai-served-"));
    storageRoot = join(dir, "project");
    socketPath = join(dir, "r.sock");
    vi.stubEnv("RAIMINISCENCE_WARM_EMBED", "");
    for (const content of ["Kafka consumer lag spikes after deploys.", "Postgres chosen for the write model.", "Retry flaky calls with backoff."]) {
      await remember({ content, client: "claude-code", storageRoot, embeddingProvider: provider });
    }
  });

  afterEach(async () => {
    await server?.close();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the same ranking as a local recall on the same store", async () => {
    server = await serveRecall({ storageRoot, embeddingProvider: provider, socketPath });
    const local = await recall({ storageRoot, query: "kafka lag", k: 10, embeddingProvider: provider, triggerConsolidation: false });

    const served = await requestServedRecall({
      socketPath,
      storageRoot,
      identity: provider.identity,
      packageVersion: PACKAGE_VERSION,
      query: "kafka lag",
      k: 10,
    });

    expect(served).not.toBeNull();
    expect(served?.map(({ id, kind, confidence, summary }) => ({ id, kind, confidence, summary }))).toEqual(
      local.results.map(({ id, kind, confidence, summary }) => ({ id, kind, confidence, summary })),
    );
  });
});

describe("serveRecall when switched off (ADR-0039)", () => {
  it("does not serve when RAIMINISCENCE_WARM_EMBED is off", async () => {
    vi.stubEnv("RAIMINISCENCE_WARM_EMBED", "off");

    expect(await serveRecall({ storageRoot: "/nowhere", embeddingProvider: provider, socketPath: join(tmpdir(), "never.sock") })).toBeUndefined();
    vi.unstubAllEnvs();
  });
});

describe("PACKAGE_VERSION (ADR-0039)", () => {
  it("is this package's own version", async () => {
    const { default: manifest } = await import("../package.json", { with: { type: "json" } });
    expect(PACKAGE_VERSION).toBe(manifest.version);
  });
});
