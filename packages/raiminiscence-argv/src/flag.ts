/**
 * Hand-rolled `--name=value` flag parsing, shared by `raiminiscence-cli`'s
 * and `raiminiscence-hooks`' independent CLIs — no new parsing
 * library/dependency for either.
 */
export function flag(argv: string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
}
