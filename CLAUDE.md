# VisionPipe - Claude Code Instructions

## Branch Progress Documentation (Required on Every Commit)

Before every `git commit`, you MUST update the branch progress document:

1. Determine the current branch name (`git branch --show-current`).
2. Look in `prd/branch commit updates/` for a markdown file matching that branch name (e.g., `prd/branch commit updates/app-iteration.md` for branch `app-iteration`).
3. If the file exists, read it, then **prepend** a new progress entry (after the header and `---` separator, before any existing entries) using the format below.
4. If no file exists for this branch, create `prd/branch commit updates/<branch-name>.md` with the header and first entry.
5. Stage the progress file along with the rest of the commit.

### Entry Format

```markdown
## Progress Update as of [YYYY-MM-DD HH:MM UTC]

### Summary of changes since last update
[One paragraph max summarizing what changed since the last entry in this document]

### Detail of changes made:
- [Bullet points with context valuable to a future LLM reading these notes to quickly ramp up on the branch status. Include file paths, architectural decisions, and why things were done a certain way.]

### Potential concerns to address:
- [Bullet points noting anything about the codebase that is or could become an issue as we continue building]
```

### Guidelines
- Be comprehensive — another agent should be able to read this file and fully understand the branch state.
- Include file paths and function names when referencing changes.
- Note architectural decisions and trade-offs, not just what changed.
- Flag known issues, tech debt, and incomplete features.
- After committing, tell the user that you have updated the branch progress file so they know it was done.

## Project Structure

- `src-tauri/` — Rust backend (Tauri v2 desktop app)
- `src/` — React + TypeScript frontend (Vite)
- `prd/` — Product requirements, design docs, and branch progress documents
- `crates/` — Rust workspace crates
