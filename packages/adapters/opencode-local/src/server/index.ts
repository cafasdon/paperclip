import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readRemoteExecutionIdentity(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const remoteCwd = readNonEmptyString(record.remoteCwd);
  if (!remoteCwd) return null;
  if (record.transport === "ssh") {
    const host = readNonEmptyString(record.host);
    const username = readNonEmptyString(record.username);
    const port = record.port;
    return host && username && typeof port === "number" && Number.isInteger(port)
      ? { transport: "ssh", host, port, username, remoteCwd }
      : null;
  }
  if (record.transport === "sandbox") {
    return {
      transport: "sandbox",
      providerKey: readNonEmptyString(record.providerKey),
      environmentId: readNonEmptyString(record.environmentId),
      leaseId: readNonEmptyString(record.leaseId),
      remoteCwd,
    };
  }
  return null;
}

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const sessionId =
      readNonEmptyString(record.sessionId) ??
      readNonEmptyString(record.session_id) ??
      readNonEmptyString(record.sessionID);
    if (!sessionId) return null;
    const cwd =
      readNonEmptyString(record.cwd) ??
      readNonEmptyString(record.workdir) ??
      readNonEmptyString(record.folder);
    const workspaceId = readNonEmptyString(record.workspaceId) ?? readNonEmptyString(record.workspace_id);
    const repoUrl = readNonEmptyString(record.repoUrl) ?? readNonEmptyString(record.repo_url);
    const repoRef = readNonEmptyString(record.repoRef) ?? readNonEmptyString(record.repo_ref);
    const mcpServerIdentity = readNonEmptyString(record.mcpServerIdentity);
    const remoteExecution = readRemoteExecutionIdentity(record.remoteExecution);
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(mcpServerIdentity ? { mcpServerIdentity } : {}),
      ...(remoteExecution ? { remoteExecution } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
    };
  },
  serialize(params: Record<string, unknown> | null) {
    if (!params) return null;
    const sessionId =
      readNonEmptyString(params.sessionId) ??
      readNonEmptyString(params.session_id) ??
      readNonEmptyString(params.sessionID);
    if (!sessionId) return null;
    const cwd =
      readNonEmptyString(params.cwd) ??
      readNonEmptyString(params.workdir) ??
      readNonEmptyString(params.folder);
    const workspaceId = readNonEmptyString(params.workspaceId) ?? readNonEmptyString(params.workspace_id);
    const repoUrl = readNonEmptyString(params.repoUrl) ?? readNonEmptyString(params.repo_url);
    const repoRef = readNonEmptyString(params.repoRef) ?? readNonEmptyString(params.repo_ref);
    const mcpServerIdentity = readNonEmptyString(params.mcpServerIdentity);
    const remoteExecution = readRemoteExecutionIdentity(params.remoteExecution);
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(mcpServerIdentity ? { mcpServerIdentity } : {}),
      ...(remoteExecution ? { remoteExecution } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
    };
  },
  getDisplayId(params: Record<string, unknown> | null) {
    if (!params) return null;
    return (
      readNonEmptyString(params.sessionId) ??
      readNonEmptyString(params.session_id) ??
      readNonEmptyString(params.sessionID)
    );
  },
};

export { execute } from "./execute.js";
export { listOpenCodeSkills, syncOpenCodeSkills } from "./skills.js";
export { testEnvironment } from "./test.js";
export {
  listOpenCodeModels,
  discoverOpenCodeModels,
  ensureOpenCodeModelConfiguredAndAvailable,
  requireOpenCodeModelId,
  resetOpenCodeModelsCacheForTests,
} from "./models.js";
export { parseOpenCodeJsonl, isOpenCodeUnknownSessionError } from "./parse.js";
