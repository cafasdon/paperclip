import { describe, expect, it } from "vitest";
import { DEFAULT_CLAUDE_LOCAL_MODEL, models, resolveClaudeModel } from "./index.js";

describe("Claude model defaults", () => {
  it.each([undefined, null, "", "  "])("uses Opus 5 for an unset model (%j)", (model) => {
    expect(DEFAULT_CLAUDE_LOCAL_MODEL).toBe("claude-opus-5");
    expect(resolveClaudeModel(model)).toBe("claude-opus-5");
  });

  it("lists Opus 5.5 and Sonnet 5.5 without changing the default", () => {
    expect(models).toContainEqual({ id: "claude-opus-5-5", label: "Claude Opus 5.5" });
    expect(models).toContainEqual({ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" });
    expect(models.some((model) => model.id === DEFAULT_CLAUDE_LOCAL_MODEL)).toBe(true);
    expect(new Set(models.map((model) => model.id)).size).toBe(models.length);
    expect(resolveClaudeModel(" claude-opus-5-5 ")).toBe("claude-opus-5-5");
    expect(resolveClaudeModel("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
  });

  it("keeps explicit model IDs ahead of environment overrides", () => {
    expect(resolveClaudeModel(" claude-sonnet-4-5 ", { ANTHROPIC_MODEL: "opus" }))
      .toBe("claude-sonnet-4-5");
    expect(resolveClaudeModel("", { ANTHROPIC_MODEL: " custom-model " })).toBe("custom-model");
  });

  it.each([
    { CLAUDE_CODE_USE_BEDROCK: "1" },
    { CLAUDE_CODE_USE_BEDROCK: "true" },
    { ANTHROPIC_BEDROCK_BASE_URL: "https://bedrock.example" },
    { CLAUDE_CODE_USE_VERTEX: "1" },
  ])("keeps provider-specific defaults for %j", (env) => {
    expect(resolveClaudeModel(undefined, env)).toBe("");
    expect(resolveClaudeModel("provider-model", env)).toBe("provider-model");
  });
});
