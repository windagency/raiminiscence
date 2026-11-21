## Configuration

Nothing is required. Two environment variables and one optional file cover the rest.

| Setting                                   | Effect                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `RAIMINISCENCE_LOG_LEVEL`                 | A pino level: `trace`, `debug`, `info`, `warn`, `error` or `fatal`. Defaults to `info`. Logs go to stderr.                              |
| `RAIMINISCENCE_WARM_EMBED=off`            | Stops a running server sharing its loaded model with the hooks and the CLI. On by default, except on Windows.                          |
| `{ "embeddingProvider": { "provider": "ollama" } }` | Uses a local Ollama server with `nomic-embed-text` instead of the built-in model.                                          |
| `{ "storageRoot": "./relative/path" }`    | Gives a monorepo subpackage its own store.                                                                                             |
| `{ "sharedMemory": true }`                | Shares memories with your team through a branch of your repository.                                                                    |
| `{ "watchedCommands": ["tsc", "pytest"] }` | Reminds the agent to save a fix after a failing build or test passes. Claude Code only.                                               |

The JSON settings go in `.raiminiscence.config.json` at the project root. Every tool call also emits an OpenTelemetry span and metrics, which cost nothing until you register an SDK. Details for each: [user guide](https://github.com/windagency/raiminiscence/blob/main/docs/user-guide.md).

## Use it as a library

The engine behind the server is importable: storage, strength and decay, Consolidation and embeddings, plus `createServer`.

```ts
import { createServer } from "raiminiscence-mcp";
```

The server speaks MCP over stdio only. Request and response shapes for every tool: [low-level design](https://github.com/windagency/raiminiscence/blob/main/docs/architecture/lld.md#mcp-tool-flows).

## Related packages

- [`raiminiscence-hooks`](https://www.npmjs.com/package/raiminiscence-hooks): memory that arrives on its own, at session start and on every turn.
- [`raiminiscence-cli`](https://www.npmjs.com/package/raiminiscence-cli): `raiminiscence-inspect`, the same diagnostics as the `inspect` tool, from a terminal.

## License

[MIT](https://github.com/windagency/raiminiscence/blob/main/LICENSE). Source, issues and contributions: [github.com/windagency/raiminiscence](https://github.com/windagency/raiminiscence).
