import { describe, expect, it } from "vitest";
import { redactSecrets } from "#src/core/redaction.js";

describe("redactSecrets", () => {
  it("redacts a password key/value assignment", () => {
    const { content, redacted } = redactSecrets("db password: hunter2-super-secret in the config");
    expect(redacted).toBe(true);
    expect(content).not.toContain("hunter2-super-secret");
    expect(content).toContain("[REDACTED]");
  });

  it("redacts credentials embedded in a connection string", () => {
    const { content, redacted } = redactSecrets("connected via postgres://admin:sup3rSecret@db.internal:5432/app");
    expect(redacted).toBe(true);
    expect(content).not.toContain("sup3rSecret");
    expect(content).not.toContain("admin");
    expect(content).toContain("db.internal:5432/app");
  });

  it("redacts a bearer token", () => {
    const { content, redacted } = redactSecrets("called the API with Authorization: Bearer abcdef1234567890xyz");
    expect(redacted).toBe(true);
    expect(content).not.toContain("abcdef1234567890xyz");
  });

  it("redacts a raw AWS access key id", () => {
    const { content, redacted } = redactSecrets("found AKIAABCDEFGHIJKLMNOP hardcoded in a script"); // gitleaks:allow
    expect(redacted).toBe(true);
    expect(content).not.toContain("AKIAABCDEFGHIJKLMNOP"); // gitleaks:allow
  });

  it("leaves non-secret content unchanged and reports redacted: false", () => {
    const input = "Chose Postgres for the write model because of transactional guarantees.";
    const { content, redacted } = redactSecrets(input);
    expect(redacted).toBe(false);
    expect(content).toBe(input);
  });
});
