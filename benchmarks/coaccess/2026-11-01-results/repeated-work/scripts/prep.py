"""Builds the repeated-work workload from a repo's own history. Rules registered in replay.mts.

usage: python3 -I prep.py <repo dir> <out json>
"""
import json
import subprocess
import sys

TEXT_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".py", ".rst", ".txt", ".toml", ".cfg", ".yml", ".yaml", ".html", ".css", ".jsx", ".ini"}
LOCKFILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock", "uv.lock", "poetry.lock"}
MAX_BYTES = 100_000
BODY_CHARS = 2000
TEST_SHARE = 0.2


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True).stdout


def eligible(path):
    name = path.rsplit("/", 1)[-1]
    return name not in LOCKFILES and any(name.endswith(e) for e in TEXT_EXT)


def main():
    repo, out = sys.argv[1], sys.argv[2]
    shas = git(repo, "rev-list", "--no-merges", "--reverse", "HEAD").decode().split()
    split = int(len(shas) * (1 - TEST_SHARE))
    snapshot = shas[split - 1]
    files = {}
    for path in git(repo, "ls-tree", "-r", "--name-only", snapshot).decode().splitlines():
        if not eligible(path):
            continue
        blob = git(repo, "show", f"{snapshot}:{path}")
        if len(blob) > MAX_BYTES:
            continue
        try:
            text = blob.decode()
        except UnicodeDecodeError:
            continue
        files[path] = f"{path}\n{text[:BODY_CHARS]}"
    commits = []
    for i, sha in enumerate(shas):
        message = git(repo, "log", "-1", "--format=%B", sha).decode().strip()[:BODY_CHARS]
        changed = [p for p in git(repo, "show", "--format=", "--name-only", sha).decode().splitlines() if p]
        commits.append({"sha": sha, "phase": "train" if i < split else "test", "message": message, "changed": changed, "inStore": [p for p in changed if p in files]})
    test = [c for c in commits if c["phase"] == "test" and 2 <= len(c["inStore"]) <= 10 and c["message"]]
    json.dump({"snapshot": snapshot, "files": files, "train": [c for c in commits if c["phase"] == "train" and c["message"]], "test": test}, open(out, "w"))
    print(f"{repo}: snapshot {snapshot[:10]}, {len(files)} files, {split} train commits, {len(commits) - split} test commits, {len(test)} scored")


if __name__ == "__main__":
    main()
