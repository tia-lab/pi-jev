import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/index.js";
import type { Answer } from "../src/index.js";

const enabled = process.env.PI_JEV_LIVE === "1" && Boolean(process.env.TYPESAFE_API_KEY);

test("live: a tiny noul call returns a probability", { skip: enabled ? false : "set PI_JEV_LIVE=1 and TYPESAFE_API_KEY" }, async () => {
  const response = await evaluate({
    state: "The sky is blue on a clear day.",
    questions: {
      clear: { type: "noul", instructions: "Does the state describe a clear daytime sky?" },
    },
  });

  const answer = response.answers.clear as Answer | undefined;
  assert.equal(answer?.type, "noul");
  assert.equal(typeof (answer as { noul?: unknown }).noul, "number");
  const noul = (answer as { noul: number }).noul;
  assert.ok(noul >= 0 && noul <= 1, `noul ${noul} is in [0, 1]`);
  assert.equal(typeof response.model, "string");
});
