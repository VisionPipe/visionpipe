# Claude Code project memory

This directory holds the auto-loaded memory files for Claude Code sessions
working in this repo. Living in the repo (instead of only in
`~/.claude/projects/<...>/memory/`) means:

- The lessons follow the project across machines / collaborators.
- Future Claude sessions on a fresh clone don't repeat bugs we already
  shipped (audioSeconds camelCase, global-shortcut deadlock, the
  HistoryHub title-bar height, etc.).
- Diffs are reviewable like any other code.

## Files

- **`MEMORY.md`** — index. Claude loads this first; every line is a one-line
  pointer to a sibling file. Keep entries terse (~150 chars).
- **`release-workflow.md`** — how to cut a release from this repo. The
  short version: `./scripts/release.sh` (default patch). DON'T do steps
  manually. The script handles version bump → build → sign → notarize →
  DMG → push to all three repos → GitHub release → homebrew tap.
- **`tauri-gotchas.md`** — running list of platform pitfalls hit while
  building the Tauri/Rust integration. Read this BEFORE writing native
  code. Append a new section whenever a new gotcha surfaces; don't
  replace the existing list — the point is to compound knowledge.

## Setup on a fresh Mac

Claude Code loads memory from a per-project path derived from the
project's working directory:

```
~/.claude/projects/<slugified-cwd>/memory/
```

For this repo on a Mac where it's cloned to `~/projects/visionpipe`,
that path is:

```
~/.claude/projects/-Users-<username>-projects-visionpipe/memory/
```

To wire up the in-repo memory as the source for that path, replace the
auto-generated memory dir with a symlink:

```sh
# Adjust <username> + <repo-path-slug> for your machine.
SLUG=$(echo "$PWD" | sed 's|/|-|g')   # works when run from the repo root
MEM=~/.claude/projects/${SLUG}/memory
mkdir -p "$(dirname "$MEM")"
rm -rf "$MEM"
ln -s "$PWD/docs/claude-memory" "$MEM"
```

Verify: `ls -la "$MEM"` should show a symlink to `docs/claude-memory/`,
and `cat "$MEM/MEMORY.md"` should print the index.

## Adding new memory

When Claude (or you) wants to add a new memory:

1. Create the file in `docs/claude-memory/<name>.md` with the standard
   frontmatter (see existing files for format — `name`, `description`,
   `type` are the required fields).
2. Add a one-line pointer to `MEMORY.md` so it shows up in the auto-load
   index.
3. Commit + push like any other source change. Don't gate behind a PR
   for tiny knowledge additions — this is a learning log, not a spec.

## What NOT to put here

- Anything that depends on the user's personal preferences or workflow
  rather than the project itself (those live in
  `~/.claude/CLAUDE.md` per-user).
- Secrets — frontmatter and body are committed, so no API keys, tokens,
  or anything you wouldn't want on GitHub.
- Ephemeral session state (in-progress tasks, current conversation
  context) — that's what `TaskCreate` is for.
