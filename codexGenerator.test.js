import test from "node:test";
import assert from "node:assert/strict";
import { createGenerator } from "./codexGenerator.js";
import { rulesPrompt, translatePrompt, repairPrompt } from "./prompts.js";

test("uses ChatGPT auth, strips API credentials and passes prompts to independent read-only threads", async () => {
  let options;
  const threads = [];
  class FakeCodex {
    constructor(input) { options = input; }
    startThread(input) {
      threads.push(input);
      return { run: async (prompt, { signal }) => {
        assert.match(prompt, /Do not inspect files/);
        assert.ok(signal instanceof AbortSignal);
        return { finalResponse: "generated text" };
      } };
    }
  }
  const generate = createGenerator({ CodexClient: FakeCodex, env: {
    PATH: "test-path", OPENAI_API_KEY: "api-key", CODEX_API_KEY: "api-key", GEMINI_API_KEY: "old-key",
    OPENAI_BASE_URL: "https://other-provider.invalid", CODEX_MODEL: "test-model", CODEX_HOME: "auth-store",
  } });
  assert.equal(await generate("rules"), "generated text");
  assert.equal(await generate("code"), "generated text");
  assert.equal(options.config.forced_login_method, "chatgpt");
  assert.equal(options.config.model_provider, "openai");
  for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "OPENAI_BASE_URL"]) assert.equal(options.env[key], undefined);
  assert.equal(options.env.CODEX_HOME, "auth-store");
  assert.equal(threads.length, 2);
  assert.equal(threads[0].sandboxMode, "read-only");
  assert.equal(threads[0].model, "test-model");
});

test("classifies authentication, usage limits, empty responses and generic failures separately", async () => {
  for (const [detail, code, hint] of [
    ["not logged in", "CODEX_AUTHENTICATION", /npm run login/],
    ["HTTP 429 rate limit exceeded", "CODEX_USAGE_LIMIT", /usage\/rate limit/],
    ["connection reset", "CODEX_REQUEST_FAILED", /connection reset/],
    ["empty", "CODEX_EMPTY_RESPONSE", /empty response/],
  ]) {
    class FakeCodex { startThread() { return { run: async () => {
      if (detail === "empty") return {finalResponse:" "};
      throw new Error(detail);
    } }; } }
    await assert.rejects(createGenerator({CodexClient:FakeCodex,env:{}})("prompt"), error => {
      assert.equal(error.code,code); assert.match(error.message,hint);
      if (code!=="CODEX_AUTHENTICATION") assert.doesNotMatch(error.message,/npm run login/);
      return true;
    });
  }
  assert.throws(()=>createGenerator({env:{GENERATION_TIMEOUT_MS:"bad"}}),/nonnegative integer/);
  assert.throws(()=>createGenerator({env:{GENERATION_TIMEOUT_MS:"-1"}}),/nonnegative integer/);
  assert.throws(()=>createGenerator({env:{GENERATION_TIMEOUT_MS:"2147483648"}}),/nonnegative integer/);
});

test("local deadline reports a timeout rather than plan exhaustion", async () => {
  class FakeCodex { startThread() { return {run:(_prompt,{signal})=>new Promise((_resolve,reject)=> {
    signal.addEventListener('abort',()=>reject(new DOMException('The operation was aborted.','AbortError')),{once:true});
  })}; } }
  const generate=createGenerator({CodexClient:FakeCodex,env:{GENERATION_TIMEOUT_MS:'10'}});
  await assert.rejects(generate('slow request'),error=> {
    assert.equal(error.code,'GENERATION_TIMEOUT');
    assert.equal(error.timeoutMs,10);
    assert.match(error.message,/Local generation timeout/);
    assert.match(error.message,/GENERATION_TIMEOUT_MS/);
    assert.doesNotMatch(error.message,/login|quota|plan limits/i);
    return true;
  });
});

test("timeout can be disabled and progress reports request start/completion", async () => {
  const messages=[];
  class FakeCodex { startThread() { return {run:async(_prompt,{signal})=> {
    await new Promise(resolve=>setTimeout(resolve,15));
    assert.equal(signal.aborted,false);
    return {finalResponse:'complete'};
  }}; } }
  const generate=createGenerator({CodexClient:FakeCodex,env:{GENERATION_TIMEOUT_MS:'0'},onProgress:message=>messages.push(message)});
  assert.equal(await generate('prompt'),'complete');
  assert.match(messages[0],/no local timeout/);
  assert.match(messages.at(-1),/completed/);
});

test("external cancellation and SDK aborts do not trigger authentication advice", async () => {
  class FakeCodex { startThread() { return {run:async()=> {throw new DOMException('The operation was aborted.','AbortError');}}; } }
  const generate=createGenerator({CodexClient:FakeCodex,env:{}});
  const controller=new AbortController(); controller.abort();
  for (const options of [{signal:controller.signal},{}]) {
    await assert.rejects(generate('prompt',options),error=> {
      assert.equal(error.code,'GENERATION_ABORTED');
      assert.doesNotMatch(error.message,/login|plan limits|quota/i);
      return true;
    });
  }
});

test("formats prompts without interpreting braces in user input or game JavaScript", () => {
  assert.match(rulesPrompt({ idea: "an astronaut {jumping}" }), /astronaut \{jumping\}/);
  const code = '<script>const player = { x: 0 };</script>';
  assert.ok(repairPrompt({ rules: "jump", code, errors: "bad syntax" }).includes(code));
  assert.match(translatePrompt({ rules: "jump" }), /complete HTML document/);
});
