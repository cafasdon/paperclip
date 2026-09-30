import { describe, expect, it } from "vitest";
import { createStreamingSecretRedactor } from "./secret-redactor.js";

describe("streaming secret redaction", () => {
  it("redacts a bearer split across stdout and stderr chunks independently", async () => {
    const logged: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };
    const redactor = createStreamingSecretRedactor(["abc123-secret"], async (stream, chunk) => {
      logged[stream] += chunk;
    });
    await redactor.write("stdout", "before abc123-");
    await redactor.write("stderr", "error abc");
    await redactor.write("stdout", "secret after");
    await redactor.write("stderr", "123-secret done");
    await redactor.flush();
    expect(logged).toEqual({
      stdout: "before ***REDACTED*** after",
      stderr: "error ***REDACTED*** done",
    });
  });

  it("redacts every two-chunk split point", async () => {
    const secret = "abc123-secret";
    for (let split = 1; split < secret.length; split += 1) {
      let logged = "";
      const redactor = createStreamingSecretRedactor([secret], async (_stream, chunk) => { logged += chunk; });
      await redactor.write("stdout", `before ${secret.slice(0, split)}`);
      await redactor.write("stdout", `${secret.slice(split)} after`);
      await redactor.flush();
      expect(logged, `split at ${split}`).toBe("before ***REDACTED*** after");
    }
  });

  it("holds a prefix of an unfinished bearer at stream end", async () => {
    let logged = "";
    const redactor = createStreamingSecretRedactor(["abc123-secret"], async (_stream, chunk) => { logged += chunk; });
    await redactor.write("stdout", "before abc123-");
    await redactor.flush();
    expect(logged).toBe("before ***REDACTED***");
  });

  it("does not leak overlapping bearer prefixes", async () => {
    let logged = "";
    const redactor = createStreamingSecretRedactor(["bcde", "dexyz"], async (_stream, chunk) => { logged += chunk; });
    await redactor.write("stdout", "abcdex");
    await redactor.write("stdout", "yz");
    await redactor.flush();
    expect(logged).not.toContain("bcde");
    expect(logged).not.toContain("dexyz");
  });
});
