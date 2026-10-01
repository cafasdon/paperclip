type LogStream = "stdout" | "stderr";

/** Keeps possible bearer prefixes private until the next chunk settles them. */
export function createStreamingSecretRedactor(
  initialSecrets: string[],
  emit: (stream: LogStream, chunk: string) => Promise<void>,
) {
  const secrets = [...new Set(initialSecrets.filter(Boolean))].sort((a, b) => b.length - a.length);
  const pending: Record<LogStream, string> = { stdout: "", stderr: "" };
  const queued: Record<LogStream, Promise<void>> = { stdout: Promise.resolve(), stderr: Promise.resolve() };

  const redact = (value: string) => secrets.reduce(
    (text, secret) => text.replaceAll(secret, "***REDACTED***"), value,
  );

  const write = (stream: LogStream, chunk: string): Promise<void> => {
    if (secrets.length === 0) {
      if (chunk) queued[stream] = queued[stream].then(() => emit(stream, chunk));
      return queued[stream];
    }
    const value = pending[stream] + chunk;
    let offset = 0;
    const output: string[] = [];
    while (offset < value.length) {
      const remaining = value.slice(offset);
      const full = secrets.find((secret) => remaining.startsWith(secret));
      const longerPartial = secrets.some((secret) =>
        secret.length > (full?.length ?? 0) && remaining.length < secret.length && secret.startsWith(remaining),
      );
      if (longerPartial) break;
      if (full) {
        output.push("***REDACTED***");
        offset += full.length;
      } else {
        output.push(value[offset]!);
        offset += 1;
      }
    }
    pending[stream] = value.slice(offset);
    const safeChunk = output.join("");
    if (safeChunk) {
      queued[stream] = queued[stream].then(() => emit(stream, safeChunk));
    }
    return queued[stream];
  };

  const flush = async (): Promise<void> => {
    for (const stream of ["stdout", "stderr"] as const) {
      if (pending[stream]) {
        pending[stream] = "";
        queued[stream] = queued[stream].then(() => emit(stream, "***REDACTED***"));
      }
    }
    await Promise.all([queued.stdout, queued.stderr]);
  };

  return {
    addSecret(secret: string) {
      if (secret && !secrets.includes(secret)) {
        secrets.push(secret);
        secrets.sort((a, b) => b.length - a.length);
      }
    },
    redact,
    write,
    flush,
  };
}
