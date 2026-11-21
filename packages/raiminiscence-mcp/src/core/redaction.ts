const MASK = "[REDACTED]";

/**
 * Best-effort, pattern-based secret redaction — not a compliance guarantee.
 * Matches are replaced in place rather than rejected, so `remember` never
 * fails on content that merely looks like it contains a credential.
 */
/** Credentials embedded in a connection-string URL: scheme://user:pass@host */
const CONNECTION_STRING_PATTERN = /:\/\/([^:@\/\s]+):([^:@\/\s]+)@/g;

/** key: value / key=value assignments for common secret-shaped field names */
const SECRET_ASSIGNMENT_PATTERN =
  /\b(api[_-]?key|secret(?:[_-]?key)?|access[_-]?key|private[_-]?key|token|password|passwd|pwd)\b(\s*[:=]\s*)["']?([^\s"'#,;]{6,})["']?/gi;

const SECRET_PATTERNS: RegExp[] = [
  CONNECTION_STRING_PATTERN,
  SECRET_ASSIGNMENT_PATTERN,
  // Bearer/Authorization-header-style tokens
  /\bBearer\s+[A-Za-z0-9._-]{10,}/gi,
  // Well-known raw API key shapes that appear with no surrounding label
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
];

export interface RedactionResult {
  content: string;
  redacted: boolean;
}

export function redactSecrets(content: string): RedactionResult {
  let redacted = false;
  let output = content;

  output = output.replace(CONNECTION_STRING_PATTERN, (_match, user: string, _pass: string) => {
    redacted = true;
    return `://${MASK}:${MASK}@`;
  });

  output = output.replace(SECRET_ASSIGNMENT_PATTERN, (_match, key: string, separator: string) => {
    redacted = true;
    return `${key}${separator}${MASK}`;
  });

  for (const pattern of SECRET_PATTERNS.slice(2)) {
    output = output.replace(pattern, () => {
      redacted = true;
      return MASK;
    });
  }

  return { content: output, redacted };
}
