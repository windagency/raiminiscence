# Every file read back from disk is validated, and a bad one degrades instead of breaking the caller

[Back to 0027-zod-confined-to-schema-modules.md](0027-zod-confined-to-schema-modules.md) • [Back to docs/adr/README.md](README.md)

ADR-0027 covered external input: config, tool input, hook stdin, flags, Ollama responses, record envelopes. Five more kinds of file reached code through a bare type cast:

- Memory frontmatter, which Shared Memory merges in from other writers' stores, and which nothing stops a person or tool from altering outside the server;
- the hooks' per-session state files;
- the recall cache's version marker and slot files;
- Opportunistic Consolidation's debounce state;
- the client hook config files `raiminiscence-hooks-install` rewrites (`settings.json`, `hooks.json`, `config.toml`), which belong to the user.

## Decision

Memory files are written only by the server's own tools. They are not hand-edited: a correction is `forget` plus a fresh `remember`, as the HLD already states for content. This supersedes the "editable without tooling" clause of [ADR-0001](0001-flat-file-markdown-storage.md) only; its human-readable, diffable flat files stand.

Each file kind gets a `*-schema.ts` parse function, and each caller picks the failure mode its data can afford:

- **Memory files** (`core/memory-frontmatter-schema.ts`): the schema is enforced, with no coercion of near-miss values. An invalid file is skipped and logged at `warn` with its path. `readAllMemories` leaves it out and `readMemory` treats it as absent, so one bad file can't break `recall` or `consolidate`. Every field added after v1 stays optional, since schema bumps are migration-free. `.passthrough()` keeps unknown fields, so a newer writer's frontmatter survives a round trip through an older version.
- **Internal state** (`hooks/hook-state-schema.ts`, `core/cache-state-schema.ts`): a wrong shape reads as absent, like corrupt JSON already did. Hook state and consolidation state log it. For the recall cache only the version marker and the `{ version, data }` envelope are checked: `data` is a whole corpus this package wrote atomically and trusts only on a version match, and re-validating it on every read would cost what the cache exists to save.
- **Client configs** (`hooks/hook-config-schema.ts`): a malformed hook path throws an error naming the file and stops the installer before it writes. Only the path the installers walk is checked; every other key passes through untouched. This replaces the installer's seven justified `any`s.

## Consequences

- A Memory file altered outside the tools into an invalid shape is hidden from every tool. The warning names the file. `forget` can't reach it, since lookup treats it as absent; the fix is to restore the file from git, or delete it and `remember` the content again.
- `logger.ts`'s `fallbackLogger()` is now shared by config resolution and the Memory file layer, neither of which has logger injection.
