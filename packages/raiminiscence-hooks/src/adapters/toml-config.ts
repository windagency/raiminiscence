import { parse, stringify } from "smol-toml";

/**
 * Adapter boundary for `smol-toml` (`CODING_RULES/04-architecture.md`'s
 * adapter-pattern requirement for a third-party library with real
 * footprint) — application code depends on this interface, never on
 * `smol-toml` directly, so a client library swap or breaking upstream
 * change touches only this file.
 */
export interface TomlConfig {
  parse(text: string): unknown;
  stringify(value: unknown): string;
}

export const smolTomlAdapter: TomlConfig = {
  parse: (text) => parse(text),
  stringify: (value) => stringify(value),
};
