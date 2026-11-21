import { z } from "zod";

/** ADR-0038: a warm-embed request, validated where it crosses the local socket. */
const warmEmbedRequestSchema = z.object({ text: z.string(), role: z.enum(["query", "document"]) });

/** ADR-0038: a warm-embed reply. A vector, when present, is a non-empty list of finite numbers. */
const warmEmbedReplySchema = z.object({
  identity: z.object({ provider: z.string(), model: z.string(), prompt: z.string().optional() }),
  vector: z.array(z.number().finite()).min(1).nullable(),
});

export interface WarmEmbedReply {
  identity: { provider: string; model: string; prompt?: string };
  vector: number[] | null;
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** The text a request line asks to embed and its role (ADR-0042), or `null` when the line isn't the expected shape. */
export function parseWarmEmbedRequest(line: string): { text: string; role: "query" | "document" } | null {
  const parsed = warmEmbedRequestSchema.safeParse(parseLine(line));
  return parsed.success ? parsed.data : null;
}

/** A reply line's identity and vector, or `null` when there is no line or it isn't the expected shape. */
export function parseWarmEmbedReply(line: string | null): WarmEmbedReply | null {
  if (line === null) return null;
  const parsed = warmEmbedReplySchema.safeParse(parseLine(line));
  return parsed.success ? parsed.data : null;
}
