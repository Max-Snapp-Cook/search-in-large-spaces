import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { repairUntilPlayable } from "./repairLoop.js";

const failed = { ok: false, stage: "compile", errors: ["Bad syntax"], diagnostics: "Ludii details" };
const passed = { ok: true, stage: "complete", errors: [] };

async function fixture(t) {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "ludii-repair-test-"));
  t.after(async () => {
    for (const file of await fs.readdir(outDir)) await fs.unlink(path.join(outDir, file));
    await fs.rmdir(outDir);
  });
  return { outDir, code: "initial", rules: "original rules", examples: "references" };
}

test("accepts the first valid game without calling repair", async (t) => {
  const input = await fixture(t);
  const result = await repairUntilPlayable({ ...input, validate: async () => passed,
    repair: () => assert.fail("Unexpected repair") });
  assert.equal(result.repairs, 0);
  assert.equal(await fs.readFile(path.join(input.outDir, "game.lud"), "utf8"), "initial");
});

test("repairs the latest code with fixed rules and saves each validation", async (t) => {
  const input = await fixture(t);
  let calls = 0;
  await repairUntilPlayable({ ...input,
    validate: async (file) => (await fs.readFile(file, "utf8")) === "fixed" ? passed : failed,
    repair: async (feedback) => {
      assert.equal(feedback.rules, input.rules);
      assert.equal(feedback.examples, input.examples);
      assert.equal(feedback.code, calls === 0 ? "initial" : "still broken");
      assert.match(feedback.errors, /Ludii details/);
      return ++calls === 1 ? "still broken" : "```lud\nfixed\n```";
    },
  });
  assert.equal(calls, 2);
  assert.equal(await fs.readFile(path.join(input.outDir, "game.lud"), "utf8"), "fixed");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(input.outDir, "attempt-0.json"))), failed);
});

test("limit allows exactly the requested repairs, including zero", async (t) => {
  for (const maxRepairs of [0, 2]) {
    const input = await fixture(t);
    let repairs = 0, validations = 0;
    await assert.rejects(repairUntilPlayable({ ...input, maxRepairs,
      validate: async () => { validations++; return failed; },
      repair: async () => { repairs++; return "broken"; },
    }), /repair_limit_reached/);
    assert.equal(repairs, maxRepairs);
    assert.equal(validations, maxRepairs + 1);
    await assert.rejects(fs.access(path.join(input.outDir, "game.lud")));
  }
});

test("setup failures stop without asking the model", async (t) => {
  const input = await fixture(t);
  await assert.rejects(repairUntilPlayable({ ...input,
    validate: async () => ({ ...failed, stage: "setup" }),
    repair: () => assert.fail("Unexpected repair"),
  }), /validation_failed/);
});

test("model failure preserves the attempted game and records failure", async (t) => {
  const input = await fixture(t);
  await assert.rejects(repairUntilPlayable({ ...input, validate: async () => failed,
    repair: async () => { throw new Error("API unavailable"); },
  }), /API unavailable/);
  const result = JSON.parse(await fs.readFile(path.join(input.outDir, "result.json")));
  assert.equal(result.status, "repair_failed");
  assert.equal(await fs.readFile(result.lastAttempt, "utf8"), "initial");
});
