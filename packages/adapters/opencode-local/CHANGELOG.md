# @paperclipai/adapter-opencode-local

## Unreleased

### Patch Changes

- Inject Paperclip-managed remote MCP servers into a private per-run OpenCode config, route project tools through a revocable run bridge on remote targets, redact split bearer logs, clean staged credentials, and avoid resuming sessions with a changed MCP server set.
- Parse and consolidate OpenCode's JSONC global config layers before adding managed credentials, reject later config overrides, and allow the client's tool timeout to outlast the gateway's 60-second maximum.
- Reassert managed MCP endpoints through a final file-backed OpenCode config layer so home configuration cannot redirect a bearer to another URL.

## 0.3.1

### Patch Changes

- Stable release preparation for 0.3.1
- Updated dependencies
  - @paperclipai/adapter-utils@0.3.1

## 0.3.0

### Minor Changes

- Stable release preparation for 0.3.0

### Patch Changes

- Updated dependencies
  - @paperclipai/adapter-utils@0.3.0

## 0.2.7

### Patch Changes

- Add local OpenCode adapter package with server/UI/CLI modules.
