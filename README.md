# DeepSeek Harness Context Plugin (`dsh-context-plugin`)

A dynamic Cordis plugin for DeepSeek Harness (DSH) that adds an interactive UI window to scan workspace files and ingest them directly into the active chat session as individual prompt turns.

## Features

- **Interactive UI Window**:
  - Rendered in `shell.overlay` with support for minimize and close.
  - Quick launcher button docked in `conversation.session.header.actions`.
  - Button dynamically displays the active workspace root directory.
  - Editable input override to type or change the workspace directory path.
- **Header Link Formatting**:
  - Configurable switch between standard Linux `file:///` URIs and IDE `vscode://file/` URIs.
  - Link format: `[`<relative-path>`](file://<abs-path>)`.
- **Dynamic Backtick Escaping**:
  - Dynamically calculates enclosing code fence backtick length ($\ge 3$ backticks) so files containing markdown or nested code fences never break the outer block.
- **Binary / Non-Text File Detection**:
  - Inspects file extensions and scans the first 8 KB for null bytes (`\0`).
  - Replaces binary contents with `*Binary file - content not displayed.*`.
- **Git & Ignore Rules**:
  - Always ignores `.git/` across all directories.
  - Respects `.gitignore` and `.dshignore` rules from the workspace root (including negation `!` patterns).
  - Skips walking ignored directories entirely for performance.
- **Real-Time Progress Feedback**:
  - Live animated spinner and counter (`Reading 5/42...`, `Injecting 5/42...`).
  - Visual progress bar.
  - Interactive file selection checklist before ingestion.
- **Individual User Prompt Turns**:
  - Dispatches each file as an individual prompt turn into the chat session queue.

## Prompt Turn Format

```markdown
[`relative/path/to/file`](file:///absolute/path/to/workspace/relative/path/to/file)

```{extension}
{file_contents}
```
```

## Structure

- `src/host.js`: Node.js host-side plugin handling filesystem queries, ignore rule resolution, and binary checks.
- `src/client.js`: Browser client-side plugin rendering the floating overlay window and header action button in Cordis slots.
