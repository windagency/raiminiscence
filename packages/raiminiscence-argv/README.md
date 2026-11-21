# raiminiscence-argv

Hand-rolled `--name=value` flag parsing and flag-value validation, shared by
`raiminiscence-cli`'s and `raiminiscence-hooks`' independent CLIs — no
argv-parsing library dependency for either.

## Usage

```ts
import { flag, parseAllowedValue, parseDateValue, parseNumberValue } from "raiminiscence-argv";

flag(["--kind=decision"], "kind"); // -> "decision"
flag(["--kind=decision"], "tier"); // -> undefined

parseAllowedValue("decision", ["episodic", "decision"]); // -> "decision"
parseNumberValue("0.5"); // -> 0.5
parseNumberValue("half"); // -> undefined
parseDateValue("2026-01-01"); // -> Date
```

Each `parse*Value` returns `undefined` for a value it rejects; the CLI decides
the error message.

## Notes

Kept as its own workspace package so `raiminiscence-cli` and
`raiminiscence-hooks` can each depend on it without depending on each other.
