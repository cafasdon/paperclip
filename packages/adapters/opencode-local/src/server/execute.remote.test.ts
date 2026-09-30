import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  runChildProcess,
  ensureCommandResolvable,
  resolveCommandForLogs,
  prepareWorkspaceForSshExecution,
  restoreWorkspaceFromSshExecution,
  runSshCommand,
  syncDirectoryToSsh,
  startAdapterExecutionTargetPaperclipBridge,
} = vi.hoisted(() => ({
  runChildProcess: vi.fn(async (_runId: string, _command: string, args: string[]) => {
    if (args.includes("models")) {
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "opencode/gpt-5-nano\nopenai/gpt-4.1\n",
        stderr: "",
        pid: 122,
        startedAt: new Date().toISOString(),
      };
    }
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: [
        JSON.stringify({ type: "step_start", sessionID: "session_123" }),
        JSON.stringify({ type: "text", sessionID: "session_123", part: { text: "hello" } }),
        JSON.stringify({
          type: "step_finish",
          sessionID: "session_123",
          part: { cost: 0.001, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } },
        }),
      ].join("\n"),
      stderr: "",
      pid: 123,
      startedAt: new Date().toISOString(),
    };
  }),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "ssh://fixture@127.0.0.1:2222/remote/workspace :: opencode"),
  prepareWorkspaceForSshExecution: vi.fn(async () => ({ gitBacked: false })),
  restoreWorkspaceFromSshExecution: vi.fn(async () => undefined),
  runSshCommand: vi.fn(async (_spec?: unknown, _command?: string) => ({
    stdout: "/home/agent",
    stderr: "",
    exitCode: 0,
  })),
  syncDirectoryToSsh: vi.fn(async (_input?: { localDir: string; remoteDir: string }) => undefined),
  startAdapterExecutionTargetPaperclipBridge: vi.fn(async () => ({
    env: {
      PAPERCLIP_API_URL: "http://127.0.0.1:4310",
      PAPERCLIP_API_KEY: "bridge-token",
      PAPERCLIP_API_BRIDGE_MODE: "queue_v1",
    },
    stop: async () => {},
  })),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensureCommandResolvable,
    resolveCommandForLogs,
    runChildProcess,
  };
});

vi.mock("@paperclipai/adapter-utils/ssh", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/ssh")>(
    "@paperclipai/adapter-utils/ssh",
  );
  return {
    ...actual,
    prepareWorkspaceForSshExecution,
    restoreWorkspaceFromSshExecution,
    runSshCommand,
    syncDirectoryToSsh,
  };
});

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return {
    ...actual,
    startAdapterExecutionTargetPaperclipBridge,
    prepareAdapterExecutionTargetRuntime: vi.fn(actual.prepareAdapterExecutionTargetRuntime),
  };
});

import { prepareAdapterExecutionTargetRuntime, type AdapterExecutionTarget } from "@paperclipai/adapter-utils/execution-target";
import { execute } from "./execute.js";

function debugConfigResult(config: unknown) {
  return {
    exitCode: 0, signal: null, timedOut: false,
    stdout: JSON.stringify(config), stderr: "", pid: 122,
    startedAt: new Date().toISOString(),
  };
}

describe("opencode remote execution", () => {
  const cleanupDirs: string[] = [];
  const originalOpenCodeAllowAllModels = process.env.OPENCODE_ALLOW_ALL_MODELS;

  beforeEach(async () => {
    const configHome = await mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-test-config-"));
    cleanupDirs.push(configHome);
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    delete process.env.OPENCODE_ALLOW_ALL_MODELS;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    if (originalOpenCodeAllowAllModels === undefined) {
      delete process.env.OPENCODE_ALLOW_ALL_MODELS;
    } else {
      process.env.OPENCODE_ALLOW_ALL_MODELS = originalOpenCodeAllowAllModels;
    }
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it.each([false, true])("prepares the workspace, syncs OpenCode skills, and restores workspace changes for remote SSH execution (managed=%s)", async (managed) => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-remote-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    const alternateWorkspaceDir = path.join(rootDir, "workspace-other");
    const managedRemoteWorkspace = "/remote/workspace/.paperclip-runtime/runs/run-1/workspace";
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(alternateWorkspaceDir, { recursive: true });

    const result = await execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "OpenCode Builder",
        adapterType: "opencode_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "opencode",
        model: "opencode/gpt-5-nano",
        ...(managed ? {
          managedAiConnection: { provider: "openrouter", method: "api_key" },
        } : {}),
        env: {
          XDG_CONFIG_HOME: path.join(rootDir, "config"),
          ...(managed ? { HOME: "/var/folders/qa-managed", XDG_DATA_HOME: "/var/folders/qa-managed/data" } : {}),
        },
      },
      context: {
        paperclipWorkspace: {
          cwd: workspaceDir,
          source: "project_primary",
        },
        paperclipWorkspaces: [
          {
            workspaceId: "workspace-1",
            cwd: workspaceDir,
            repoUrl: "https://github.com/paperclipai/paperclip.git",
            repoRef: "main",
          },
          {
            workspaceId: "workspace-2",
            cwd: alternateWorkspaceDir,
            repoUrl: "https://github.com/paperclipai/paperclip.git",
            repoRef: "feature/other",
          },
        ],
      },
      executionTransport: {
        remoteExecution: {
          host: "127.0.0.1",
          port: 2222,
          username: "fixture",
          remoteWorkspacePath: "/remote/workspace",
          remoteCwd: "/remote/workspace",
          privateKey: "PRIVATE KEY",
          knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA",
          strictHostKeyChecking: true,
        },
      },
      onLog: async () => {},
    });

    expect(result.sessionParams).toMatchObject({
      sessionId: "session_123",
      cwd: managedRemoteWorkspace,
      remoteExecution: {
        transport: "ssh",
        host: "127.0.0.1",
        port: 2222,
        username: "fixture",
        remoteCwd: managedRemoteWorkspace,
      },
    });
    expect(prepareWorkspaceForSshExecution).toHaveBeenCalledTimes(1);
    expect(syncDirectoryToSsh).toHaveBeenCalledTimes(2);
    expect(syncDirectoryToSsh).toHaveBeenCalledWith(expect.objectContaining({
      remoteDir: `${managedRemoteWorkspace}/.paperclip-runtime/opencode/xdgConfig`,
    }));
    expect(syncDirectoryToSsh).toHaveBeenCalledWith(expect.objectContaining({
      remoteDir: `${managedRemoteWorkspace}/.paperclip-runtime/opencode/skills`,
      followSymlinks: true,
    }));
    expect(runSshCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining(".claude/skills"),
      expect.anything(),
    );
    const runCall = runChildProcess.mock.calls.find((entry) => Array.isArray(entry[2]) && entry[2].includes("run")) as
      | [string, string, string[], { env: Record<string, string>; remoteExecution?: { remoteCwd: string } | null }]
      | undefined;
    const modelProbeCall = runChildProcess.mock.calls.find((entry) => Array.isArray(entry[2]) && entry[2].includes("models")) as
      | [string, string, string[], { env: Record<string, string>; remoteExecution?: { remoteCwd: string } | null }]
      | undefined;
    expect(modelProbeCall?.[2]).toEqual(["models"]);
    // The model probe runs after the runtime workspace is prepared (so XDG
    // points at the managed subdirectory) but the SSH session targets the
    // original target remoteCwd — the per-run subdirectory is layered
    // underneath via XDG/runtime config rather than by switching the cwd.
    expect(modelProbeCall?.[3].env.XDG_CONFIG_HOME).toBe(
      `${managedRemoteWorkspace}/.paperclip-runtime/opencode/xdgConfig`,
    );
    expect(modelProbeCall?.[3].remoteExecution?.remoteCwd).toBe("/remote/workspace");
    const call = runCall as
      | [string, string, string[], { env: Record<string, string>; remoteExecution?: { remoteCwd: string } | null }]
      | undefined;
    expect(call?.[3].env.PAPERCLIP_WORKSPACE_CWD).toBe(managedRemoteWorkspace);
    if (managed) {
      const home = `${managedRemoteWorkspace}/.paperclip-runtime/opencode/managed-auth/run-1`;
      expect(call?.[3].env.HOME).toBe(home);
      expect(call?.[3].env.XDG_DATA_HOME).toBe(`${home}/data`);
      expect(modelProbeCall?.[3].env.XDG_DATA_HOME).toBe(`${home}/data`);
      expect(runSshCommand).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining(`${home}/.claude/skills`),
        expect.anything(),
      );
    }
    expect(JSON.parse(call?.[3].env.PAPERCLIP_WORKSPACES_JSON ?? "[]")).toEqual([
      {
        workspaceId: "workspace-1",
        cwd: managedRemoteWorkspace,
        repoUrl: "https://github.com/paperclipai/paperclip.git",
        repoRef: "main",
      },
      {
        workspaceId: "workspace-2",
        repoUrl: "https://github.com/paperclipai/paperclip.git",
        repoRef: "feature/other",
      },
    ]);
    expect(call?.[3].env.PAPERCLIP_API_URL).toBe("http://127.0.0.1:4310");
    expect(call?.[3].env.PAPERCLIP_API_BRIDGE_MODE).toBe("queue_v1");
    expect(call?.[3].env.XDG_CONFIG_HOME).toBe(`${managedRemoteWorkspace}/.paperclip-runtime/opencode/xdgConfig`);
    expect(call?.[3].remoteExecution?.remoteCwd).toBe(managedRemoteWorkspace);
    expect(startAdapterExecutionTargetPaperclipBridge).toHaveBeenCalledTimes(1);
    expect(restoreWorkspaceFromSshExecution).toHaveBeenCalledTimes(1);
  });

  it("fails before the remote run when the configured model is unavailable on the SSH target", async () => {
    runChildProcess.mockImplementationOnce(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "openai/gpt-4.1\n",
      stderr: "",
      pid: 456,
      startedAt: new Date().toISOString(),
    }));

    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-remote-model-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });

    await expect(() =>
      execute({
        runId: "run-ssh-model-missing",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "OpenCode Builder",
          adapterType: "opencode_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: "opencode",
          model: "opencode/gpt-5-nano",
        },
        context: {
          paperclipWorkspace: {
            cwd: workspaceDir,
            source: "project_primary",
          },
        },
        executionTransport: {
          remoteExecution: {
            host: "127.0.0.1",
            port: 2222,
            username: "fixture",
            remoteWorkspacePath: "/remote/workspace",
            remoteCwd: "/remote/workspace",
            privateKey: "PRIVATE KEY",
            knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA",
            strictHostKeyChecking: true,
          },
        },
        onLog: async () => {},
      }),
    ).rejects.toThrow("Configured OpenCode model is unavailable on the remote execution target");

    expect(runChildProcess).toHaveBeenCalledTimes(1);
    expect((runChildProcess.mock.calls[0]?.[2] as string[] | undefined) ?? []).toEqual(["models"]);
    expect(startAdapterExecutionTargetPaperclipBridge).not.toHaveBeenCalled();
  });

  it("resumes saved OpenCode sessions for remote SSH execution only when the identity matches", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-remote-resume-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    const managedRemoteWorkspace = "/remote/workspace/.paperclip-runtime/runs/run-ssh-resume/workspace";
    await mkdir(workspaceDir, { recursive: true });

    await execute({
      runId: "run-ssh-resume",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "OpenCode Builder",
        adapterType: "opencode_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: "session-123",
        sessionParams: {
          sessionId: "session-123",
          cwd: managedRemoteWorkspace,
          remoteExecution: {
            transport: "ssh",
            host: "127.0.0.1",
            port: 2222,
            username: "fixture",
            remoteCwd: managedRemoteWorkspace,
          },
        },
        sessionDisplayId: "session-123",
        taskKey: null,
      },
      config: {
        command: "opencode",
        model: "opencode/gpt-5-nano",
      },
      context: {
        paperclipWorkspace: {
          cwd: workspaceDir,
          source: "project_primary",
        },
      },
      executionTransport: {
        remoteExecution: {
          host: "127.0.0.1",
          port: 2222,
          username: "fixture",
          remoteWorkspacePath: "/remote/workspace",
          remoteCwd: "/remote/workspace",
          privateKey: "PRIVATE KEY",
          knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA",
          strictHostKeyChecking: true,
        },
      },
      onLog: async () => {},
    });

    const call = runChildProcess.mock.calls.find((entry) => Array.isArray(entry[2]) && entry[2].includes("run")) as
      | [string, string, string[]]
      | undefined;
    expect(call?.[2]).toContain("--session");
    expect(call?.[2]).toContain("session-123");
  });

  it("stages a bearer config for SSH and removes it after a remote process failure", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-mcp-remote-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    const bearer = "remote-test-bearer";
    const logs: string[] = [];
    const metadata: unknown[] = [];
    let stagedConfig: Record<string, unknown> | null = null;
    syncDirectoryToSsh.mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async (input) => {
        stagedConfig = JSON.parse(await readFile(path.join(input!.localDir, "opencode", "opencode.json"), "utf8"));
      });
    runChildProcess.mockImplementationOnce(async (_runId, _command, args) => {
      expect(args).toEqual(["debug", "config"]);
      return debugConfigResult(stagedConfig);
    }).mockRejectedValueOnce(new Error("remote OpenCode failed"));
    const configDir = "/remote/workspace/.paperclip-runtime/runs/run-mcp-ssh/workspace/.paperclip-runtime/opencode/xdgConfig";
    await expect(execute({
      runId: "run-mcp-ssh",
      agent: { id: "agent-1", companyId: "company-1", name: "OpenCode", adapterType: "opencode_local", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: "opencode", model: "opencode/gpt-5-nano", dangerouslySkipPermissions: false,
        env: { OPENCODE_ALLOW_ALL_MODELS: "1" } },
      context: { paperclipWorkspace: { cwd: workspaceDir, source: "project_primary" } },
      runtimeMcp: { getServers: () => [{ name: "research", url: "https://mcp.example.test/mcp", token: bearer, connectionId: "connection-1" }] },
      executionTransport: { remoteExecution: {
        host: "127.0.0.1", port: 2222, username: "fixture",
        remoteWorkspacePath: "/remote/workspace", remoteCwd: "/remote/workspace",
        privateKey: "PRIVATE KEY", knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA", strictHostKeyChecking: true,
      } },
      onLog: async (_stream, chunk) => { logs.push(chunk); },
      onMeta: async (meta) => { metadata.push(meta); },
    })).rejects.toThrow("remote OpenCode failed");
    expect(stagedConfig).toMatchObject({ mcp: { research: {
      type: "remote", headers: { Authorization: `Bearer ${bearer}` }, enabled: true, oauth: false,
    } } });
    const invocation = runChildProcess.mock.calls.find((call) => call[2]?.includes("run")) as unknown as
      | [string, string, string[], { env: Record<string, string> }]
      | undefined;
    const remoteOverlay = JSON.parse(invocation?.[3].env.OPENCODE_CONFIG_CONTENT ?? "null");
    // The managed overlay reads its private sidecars directly. It must not
    // replace a permissions-enforced SSH user's native provider/deny config.
    expect(invocation?.[3].env.XDG_CONFIG_HOME).toBeUndefined();
    const modelProbe = runChildProcess.mock.calls.find((call) => call[2]?.includes("models")) as unknown as
      | [string, string, string[], { env: Record<string, string> }]
      | undefined;
    expect(modelProbe?.[3].env.XDG_CONFIG_HOME).toBeUndefined();
    expect(remoteOverlay.mcp.research.url).toMatch(
      new RegExp(`^\\{file:${configDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/opencode/paperclip-managed-mcp-[a-f0-9-]+\\.url\\}$`),
    );
    expect(JSON.stringify(remoteOverlay)).not.toContain(bearer);
    expect(runSshCommand).toHaveBeenCalledWith(expect.anything(), expect.stringContaining(`chmod 600 '${configDir}/opencode/opencode.json'`), expect.anything());
    expect(runSshCommand).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("-name 'paperclip-managed-mcp-*' -exec chmod 600"), expect.anything());
    expect(runSshCommand).toHaveBeenCalledWith(expect.anything(), expect.stringContaining(`rm -rf -- '${configDir}'`), expect.anything());
    expect(JSON.stringify({ args: runChildProcess.mock.calls.map((call) => call[2]), logs, metadata })).not.toContain(bearer);
    expect(restoreWorkspaceFromSshExecution).toHaveBeenCalled();
  });

  it("removes a partially staged bearer config when SSH asset sync fails", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-mcp-stage-fail-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    syncDirectoryToSsh.mockImplementationOnce(async () => undefined)
      .mockRejectedValueOnce(new Error("synthetic partial upload partial-bearer"));
    await expect(execute({
      runId: "run-mcp-stage-fail",
      agent: { id: "agent-1", companyId: "company-1", name: "OpenCode", adapterType: "opencode_local", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: "opencode", model: "opencode/gpt-5-nano", dangerouslySkipPermissions: false,
        env: { OPENCODE_ALLOW_ALL_MODELS: "1" } },
      context: { paperclipWorkspace: { cwd: workspaceDir, source: "project_primary" } },
      runtimeMcp: { getServers: () => [{ name: "research", url: "https://mcp.example.test/mcp", token: "partial-bearer", connectionId: "connection-1" }] },
      executionTransport: { remoteExecution: {
        host: "127.0.0.1", port: 2222, username: "fixture",
        remoteWorkspacePath: "/remote/workspace", remoteCwd: "/remote/workspace",
        privateKey: "PRIVATE KEY", knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA", strictHostKeyChecking: true,
      } },
      onLog: async () => {},
    })).rejects.toThrow("synthetic partial upload ***REDACTED***");
    expect(runSshCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("rm -rf -- '/remote/workspace/.paperclip-runtime/runs/run-mcp-stage-fail/workspace/.paperclip-runtime/opencode/xdgConfig' '/remote/workspace/.paperclip-runtime/runs/run-mcp-stage-fail/workspace/.paperclip-runtime/opencode/xdgConfig-upload.tar'"),
      expect.anything(),
    );
    expect(runChildProcess).not.toHaveBeenCalled();
  });

  it("removes the credential archive when sandbox asset extraction fails", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-sandbox-extract-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    const runtimeRootDir = "/remote/workspace/.paperclip-runtime/opencode";
    const remoteConfigDir = `${runtimeRootDir}/xdgConfig`;
    const uploadTar = `${remoteConfigDir}-upload.tar`;
    const remoteFiles = new Set<string>();
    const commands: string[] = [];
    const target: AdapterExecutionTarget = {
      kind: "remote", transport: "sandbox", providerKey: "fixture", remoteCwd: "/remote/workspace",
      runner: { execute: async ({ args }) => {
        const command = args?.join(" ") ?? "";
        commands.push(command);
        if (command.includes("rm -rf --") && command.includes(uploadTar)) remoteFiles.delete(uploadTar);
        return { exitCode: 0, signal: null, timedOut: false, stdout: "/usr/bin/opencode", stderr: "", pid: null, startedAt: new Date().toISOString() };
      } },
    };
    vi.mocked(prepareAdapterExecutionTargetRuntime)
      .mockResolvedValueOnce({
        target, workspaceRemoteDir: "/remote/workspace", runtimeRootDir,
        assetDirs: { skills: `${runtimeRootDir}/skills` },
        additionalSourceDirs: {}, additionalSourceFailures: [], workspaceSyncSnapshot: null,
        restoreWorkspace: async () => {},
      })
      .mockImplementationOnce(async () => {
        remoteFiles.add(uploadTar);
        throw new Error("synthetic sandbox tar extraction failed");
      });
    await expect(execute({
      runId: "run-sandbox-extract-fail",
      agent: { id: "agent-1", companyId: "company-1", name: "OpenCode", adapterType: "opencode_local", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: "opencode", model: "opencode/gpt-5-nano", dangerouslySkipPermissions: false,
        env: { OPENCODE_ALLOW_ALL_MODELS: "1" } },
      context: { paperclipWorkspace: { cwd: workspaceDir, source: "project_primary" } },
      runtimeMcp: { getServers: () => [{ name: "research", url: "https://mcp.example.test/mcp", token: "synthetic-bearer", connectionId: "connection-1" }] },
      executionTarget: target,
      onLog: async () => {},
    })).rejects.toThrow("synthetic sandbox tar extraction failed");
    expect(commands.some((command) => command.includes("rm -rf --") && command.includes(remoteConfigDir) && command.includes(uploadTar))).toBe(true);
    expect(remoteFiles.has(uploadTar)).toBe(false);
    expect(runChildProcess).not.toHaveBeenCalled();
  });

  it("strands only a stopped run bridge token when SSH cleanup becomes unreachable", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-project-bridge-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    const agentJwt = "long-lived-project-jwt";
    const bridgeToken = "run-scoped-bridge-token";
    const logs: string[] = [];
    const metadata: unknown[] = [];
    const server = createServer((request, response) => {
      response.statusCode = request.headers.authorization === `Bearer ${bridgeToken}` ? 200 : 401;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Bridge fixture did not listen.");
    const bridgeApiUrl = `http://127.0.0.1:${address.port}`;
    const stopBridge = vi.fn(async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    });
    startAdapterExecutionTargetPaperclipBridge.mockResolvedValueOnce({
      env: { PAPERCLIP_API_URL: bridgeApiUrl, PAPERCLIP_API_KEY: bridgeToken, PAPERCLIP_API_BRIDGE_MODE: "queue_v1" },
      stop: stopBridge,
    });
    let stagedConfig: Record<string, any> | null = null;
    syncDirectoryToSsh.mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async (input) => {
        stagedConfig = JSON.parse(await readFile(path.join(input!.localDir, "opencode", "opencode.json"), "utf8"));
        const live = await fetch(`${bridgeApiUrl}/api/mcp/project-tools`, {
          method: "POST", headers: { Authorization: `Bearer ${bridgeToken}` },
        });
        expect(live.status).toBe(200);
      });
    runChildProcess.mockImplementationOnce(async (_runId, _command, args) => {
      expect(args).toEqual(["debug", "config"]);
      return debugConfigResult(stagedConfig);
    });
    runSshCommand.mockImplementation(async (_spec, command) => {
      if (command?.includes("rm -rf --")) throw new Error("ssh disconnected");
      return { stdout: "/home/agent", stderr: "", exitCode: 0 };
    });
    try {
      await expect(execute({
        runId: "run-project-bridge",
        agent: { id: "agent-1", companyId: "company-1", name: "OpenCode", adapterType: "opencode_local", adapterConfig: {} },
        runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
        config: { command: "opencode", model: "opencode/gpt-5-nano", dangerouslySkipPermissions: false,
          env: { OPENCODE_ALLOW_ALL_MODELS: "1" } },
        context: { paperclipWorkspace: { cwd: workspaceDir, source: "project_primary" } },
        authToken: agentJwt,
        runtimeMcp: { getServers: () => [{
          name: "Paperclip projects", url: "https://paperclip.example.test/api/mcp/project-tools",
          token: agentJwt, connectionId: "paperclip-project-tools",
        }] },
        executionTransport: { remoteExecution: {
          host: "127.0.0.1", port: 2222, username: "fixture",
          remoteWorkspacePath: "/remote/workspace", remoteCwd: "/remote/workspace",
          privateKey: "PRIVATE KEY", knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA", strictHostKeyChecking: true,
        } },
        onLog: async (_stream, chunk) => { logs.push(chunk); },
        onMeta: async (meta) => { metadata.push(meta); },
      })).rejects.toThrow("Failed to remove staged OpenCode runtime config.");
      expect((stagedConfig as { mcp: Record<string, unknown> } | null)?.mcp["Paperclip projects"]).toMatchObject({
        url: `${bridgeApiUrl}/api/mcp/project-tools`,
        headers: { Authorization: `Bearer ${bridgeToken}` },
      });
      expect(JSON.stringify(stagedConfig)).not.toContain(agentJwt);
      expect(JSON.stringify({ logs, metadata, processCalls: runChildProcess.mock.calls })).not.toContain(agentJwt);
      expect(JSON.stringify({ logs, metadata })).not.toContain(bridgeToken);
      expect(stopBridge).toHaveBeenCalledTimes(1);
      await expect(fetch(`${bridgeApiUrl}/api/mcp/project-tools`, {
        method: "POST", headers: { Authorization: `Bearer ${bridgeToken}` },
      })).rejects.toThrow();
    } finally {
      if (server.listening) await stopBridge();
    }
  });
});
