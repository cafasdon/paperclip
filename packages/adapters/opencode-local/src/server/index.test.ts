import { describe, expect, it } from "vitest";
import { sessionCodec } from "./index.js";

describe("OpenCode session codec", () => {
  it("retains MCP and remote identity while discarding credentials", () => {
    const saved = sessionCodec.serialize({
      sessionId: "session-1",
      cwd: "/workspace",
      mcpServerIdentity: "sha256:fixture",
      remoteExecution: {
        transport: "ssh", host: "example.test", port: 2222,
        username: "runner", remoteCwd: "/workspace", privateKey: "secret",
      },
      token: "secret",
    });
    expect(saved).toEqual({
      sessionId: "session-1",
      cwd: "/workspace",
      mcpServerIdentity: "sha256:fixture",
      remoteExecution: {
        transport: "ssh", host: "example.test", port: 2222,
        username: "runner", remoteCwd: "/workspace",
      },
    });
    expect(sessionCodec.deserialize(saved)).toEqual(saved);
    expect(JSON.stringify(saved)).not.toContain("secret");
  });
});
