import { Codex } from "@openai/codex-sdk";

export const DEFAULT_GENERATION_TIMEOUT_MS = 30 * 60 * 1000;

function requestFailure(cause, { timedOut, callerAborted, elapsedMs, timeoutMs }) {
  const detail = cause?.message || String(cause);
  let code = "CODEX_REQUEST_FAILED", message = `Codex generation failed: ${detail}`;
  if (timedOut) {
    code = "GENERATION_TIMEOUT";
    message = `Local generation timeout after ${timeoutMs} ms (${Math.round(elapsedMs / 1000)} seconds elapsed). This program cancelled the Codex request. Increase GENERATION_TIMEOUT_MS or set it to 0 to disable the local deadline, then resume this run.`;
  } else if (callerAborted || cause?.name === "AbortError" || cause?.code === "ABORT_ERR") {
    code = "GENERATION_ABORTED";
    message = `Codex generation was cancelled after ${Math.round(elapsedMs / 1000)} seconds: ${detail}`;
  } else if (/usage.?limit|rate.?limit|quota|\b429\b/i.test(detail)) {
    code = "CODEX_USAGE_LIMIT";
    message += ". Codex reported a usage/rate limit; check its reset time before resuming.";
  } else if (/not logged in|unauthorized|\b401\b|authentication|invalid.*(?:token|credential)/i.test(detail)) {
    code = "CODEX_AUTHENTICATION";
    message += ". Check npm run login:status; use npm run login if your session needs renewal.";
  } else if (/empty response/i.test(detail)) {
    code = "CODEX_EMPTY_RESPONSE";
  }
  const error = new Error(message, { cause });
  Object.assign(error, { code, elapsedMs, timeoutMs });
  return error;
}

// Use Codex's normal ChatGPT login store. Never read or copy auth tokens.
export function createGenerator({ env = process.env, CodexClient = Codex, onProgress = () => {} } = {}) {
  const childEnv = Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === "string"));
  for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL", "GEMINI_API_KEY"]) delete childEnv[key];
  const timeoutMs = Number(env.GENERATION_TIMEOUT_MS ?? DEFAULT_GENERATION_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) throw new Error("GENERATION_TIMEOUT_MS must be a nonnegative integer up to 2147483647; 0 disables the local timeout.");
  const client = new CodexClient({ env: childEnv, config: { forced_login_method: "chatgpt", model_provider: "openai" } });
  return async (prompt, { signal: callerSignal } = {}) => {
    const started = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort(callerSignal.reason);
    if (callerSignal?.aborted) cancel();
    else callerSignal?.addEventListener("abort", cancel, { once: true });
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; controller.abort(new Error("Local generation deadline exceeded")); }, timeoutMs) : undefined;
    const progress = () => onProgress(`Codex request running: ${Math.round((Date.now() - started) / 1000)} seconds elapsed; ${timeoutMs ? `local timeout ${timeoutMs / 60000} minutes` : "no local timeout"}.`);
    const heartbeat = setInterval(progress, 30_000);
    try {
      progress();
      if (controller.signal.aborted) throw callerSignal.reason || new DOMException("Cancelled", "AbortError");
      const thread = client.startThread({
        ...(env.CODEX_MODEL?.trim() ? { model: env.CODEX_MODEL.trim() } : {}),
        sandboxMode: "read-only", approvalPolicy: "never", webSearchMode: "disabled", skipGitRepoCheck: true,
      });
      const result = await thread.run(
        `Return only the requested text. Do not inspect files, run commands, use tools or edit files. All required input follows.\n\n${prompt}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!result.finalResponse?.trim()) throw new Error("Codex returned an empty response.");
      onProgress(`Codex request completed in ${Math.round((Date.now() - started) / 1000)} seconds.`);
      return result.finalResponse;
    } catch (cause) {
      throw requestFailure(cause, { timedOut, callerAborted: callerSignal?.aborted, elapsedMs: Date.now() - started, timeoutMs });
    } finally {
      clearTimeout(timer); clearInterval(heartbeat);
      callerSignal?.removeEventListener("abort", cancel);
    }
  };
}
