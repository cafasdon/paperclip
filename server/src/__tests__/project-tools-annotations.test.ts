import { afterEach, describe, expect, it, vi } from "vitest";
import { callProjectTool, projectToolDefinitions } from "../services/project-tools.js";

describe("project MCP read-only annotations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("marks only the two authenticated GET tools as read-only", () => {
    const tools = projectToolDefinitions("standard", true);
    expect(tools.filter(tool => tool.annotations?.readOnlyHint).map(tool => tool.name).sort())
      .toEqual(["list_project_repositories", "list_projects"]);
    for (const name of ["create_project", "create_task"]) {
      expect(tools.find(tool => tool.name === name)).toBeDefined();
      expect(tools.find(tool => tool.name === name)).not.toHaveProperty("annotations");
    }
  });

  it("preserves Ask and Plan mode mutation filtering", () => {
    for (const mode of ["ask", "planning"]) {
      const tools = projectToolDefinitions(mode, true);
      expect(tools.map(tool => tool.name).sort()).toEqual(["list_project_repositories", "list_projects"]);
      expect(tools.every(tool => tool.annotations?.readOnlyHint === true)).toBe(true);
    }
  });

  it.each([
    ["list_projects", "projects"],
    ["list_project_repositories", "project-repositories"],
  ])("%s uses a company-scoped authenticated GET and preserves API denials", async (name, endpoint) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callProjectTool({
      name, arguments: {}, apiUrl: "https://paperclip.example/api", token: "synthetic-token",
      companyId: "company-a", issueId: "issue-a", agentId: "agent-a", conversation: false,
    })).rejects.toThrow("Forbidden");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `https://paperclip.example/api/companies/company-a/${endpoint}`,
      expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer synthetic-token", "Content-Type": "application/json" } }),
    );
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("body");
  });
});
