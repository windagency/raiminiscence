export * from "./core/types.js";
export * from "./core/project-root.js";
export * from "./core/storage.js";
export * from "./core/engine.js";
export type { EmbeddingProvider } from "./core/embeddings/provider.js";
export { createServer } from "./server.js";

export { ensureSharedMemoryWorktree, isSharedMemoryWorktree, SHARED_MEMORY_BRANCH } from "./core/shared-memory/setup.js";
export { flushSharedMemory, pullSharedMemory, settlePendingSharedMemoryPush } from "./core/shared-memory/sync.js";
export type { SharedMemoryPullResult } from "./core/shared-memory/sync.js";
