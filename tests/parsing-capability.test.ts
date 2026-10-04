import assert from "node:assert/strict";
import test from "node:test";

import { chooseParsingPlan } from "../src/lib/parsing-capability";

function setBrowserEnvironment({
  hardwareConcurrency = 8,
  deviceMemory,
  observations = [],
}: {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  observations?: Array<{ durationMs: number; succeeded: boolean }>;
} = {}) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { hardwareConcurrency, deviceMemory },
  });

  const values = new Map<string, string>();
  values.set(
    "studybuddy:parsing-observations:v1",
    JSON.stringify(observations),
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  });
}

test("chooseParsingPlan keeps small plain text on the client", () => {
  setBrowserEnvironment();

  assert.deepEqual(
    chooseParsingPlan({ mimeType: "text/plain", sizeBytes: 1024 }),
    {
      mode: "client",
      budgetMs: 45_000,
      reason: "small plain-text file",
    },
  );
});

test("chooseParsingPlan sends large documents to the server", () => {
  setBrowserEnvironment();

  const plan = chooseParsingPlan({
    mimeType: "application/pdf",
    sizeBytes: 9 * 1024 * 1024,
  });

  assert.equal(plan.mode, "server");
  assert.equal(plan.reason, "large document");
  assert.equal(plan.budgetMs, 30_000);
});

test("chooseParsingPlan adapts complex parsing for constrained devices", () => {
  setBrowserEnvironment({ hardwareConcurrency: 2, deviceMemory: 2 });

  const plan = chooseParsingPlan({
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 1024,
  });

  assert.deepEqual(plan, {
    mode: "server",
    budgetMs: 30_000,
    reason: "complex document on a constrained device",
  });
});

test("chooseParsingPlan responds to unreliable recent client parsing", () => {
  setBrowserEnvironment({
    observations: [{ durationMs: 50_000, succeeded: true }],
  });

  const plan = chooseParsingPlan({
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    sizeBytes: 1024,
  });

  assert.equal(plan.mode, "server");
  assert.equal(plan.reason, "recent client parsing was unreliable or slow");
});
