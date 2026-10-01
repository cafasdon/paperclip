# @paperclipai/adapter-opencode-local

## Unreleased

### Patch Changes

- Inject Paperclip-managed remote MCP servers into a private per-run OpenCode config, route project tools through a revocable run bridge on remote targets, redact split bearer logs, clean staged credentials, and avoid resuming sessions with a changed MCP server set.
- Parse and consolidate OpenCode's JSONC global config layers before adding managed credentials, reject later config overrides, and allow the client's tool timeout to outlast the gateway's 60-second maximum.
- Reassert managed MCP endpoints through a final file-backed OpenCode config layer so home configuration cannot redirect a bearer to another URL.
- Preserve the SSH user's native OpenCode provider and permission config on permissions-enforced runs while loading managed MCP credentials from private per-run files.
- Remove the sandbox's credential-bearing asset upload archive if extraction or staging fails before the normal archive deletion.
- Check OpenCode's effective MCP URL and bearer privately before each managed run, reject the writable test-managed config override, and fail closed if a later policy layer retargets a managed connection.

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
