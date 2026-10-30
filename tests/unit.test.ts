import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MODEL, JEV_ENDPOINT, JevTransientError, evaluate } from "../src/index.js";
import type { JevRequest } from "../src/index.js";

const KEY = "test-key";

interface Recorded {
  url: string;
  init: RequestInit;
}

function fakeFetch(payload: unknown, status = 200) {
  const calls: Recorded[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetcher, calls };
}

const noulRequest: JevRequest = {
  state: "The build is green.",
  questions: { green: { type: "noul", instructions: "Is the state green?" } },
};

test("posts the default model with a Bearer key and parses a noul answer", async () => {
  const { fetcher, calls } = fakeFetch({
    model: "jev-1.14.0",
    answers: { green: { type: "noul", noul: 0.88 } },
    usage: { input_tokens: 322, output_tokens: 21 },
  });

  const response = await evaluate(noulRequest, { fetcher, apiKey: KEY });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, JEV_ENDPOINT);
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal(calls[0]?.init.redirect, "error");
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${KEY}`);
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(JSON.parse(String(calls[0]?.init.body)).model, DEFAULT_MODEL);

  assert.deepEqual(response, {
    model: "jev-1.14.0",
    answers: { green: { type: "noul", noul: 0.88 } },
    usage: { input_tokens: 322, output_tokens: 21 },
  });
});

test("parses choice and score answers and honors a model override", async () => {
  const { fetcher, calls } = fakeFetch({
    model: "jev-1.14.0",
    answers: {
      pick: { type: "choice", choice: "b", confidence: 0.7 },
      rate: { type: "score", score: 1, confidence: 0.6 },
    },
  });
  const request: JevRequest = {
    state: { text: "Ship it" },
    questions: {
      pick: { type: "choice", instructions: "Pick one", criteria: { a: "first", b: "second" } },
      rate: { type: "score", instructions: "Rate it", criteria: ["low", "medium", "high"] },
    },
  };

  const response = await evaluate(request, { fetcher, apiKey: KEY, model: "jev-preview" });

  assert.equal(JSON.parse(String(calls[0]?.init.body)).model, "jev-preview");
  assert.deepEqual(response.answers.pick, { type: "choice", choice: "b", confidence: 0.7 });
  assert.deepEqual(response.answers.rate, { type: "score", score: 1, confidence: 0.6 });
  assert.equal(response.usage, undefined);
});

test("rejects a missing answer instead of returning a partial response", async () => {
  const { fetcher } = fakeFetch({ model: "jev-1.14.0", answers: {} });
  await assert.rejects(evaluate(noulRequest, { fetcher, apiKey: KEY }), /invalid typed response/);
});

test("rejects malformed answer types and fields", async () => {
  const wrongType = fakeFetch({ model: "jev-1.14.0", answers: { green: { type: "score", score: 1 } } });
  await assert.rejects(evaluate(noulRequest, { fetcher: wrongType.fetcher, apiKey: KEY }), /wrong type/);

  const outOfRange = fakeFetch({ model: "jev-1.14.0", answers: { green: { type: "noul", noul: 1.5 } } });
  await assert.rejects(evaluate(noulRequest, { fetcher: outOfRange.fetcher, apiKey: KEY }), /malformed noul/);

  const choice = fakeFetch({ model: "jev-1.14.0", answers: { pick: { type: "choice", choice: "z" } } });
  const choiceRequest: JevRequest = {
    state: "x",
    questions: { pick: { type: "choice", instructions: "Pick", criteria: { a: "first" } } },
  };
  await assert.rejects(evaluate(choiceRequest, { fetcher: choice.fetcher, apiKey: KEY }), /malformed choice/);
});

test("rejects a non-JSON body and unexpected answer ids", async () => {
  const invalidJson = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(evaluate(noulRequest, { fetcher: invalidJson, apiKey: KEY }), /invalid typed response/);

  const extra = fakeFetch({
    model: "jev-1.14.0",
    answers: { green: { type: "noul", noul: 0.5 }, other: { type: "noul", noul: 0.5 } },
  });
  await assert.rejects(evaluate(noulRequest, { fetcher: extra.fetcher, apiKey: KEY }), /missing or unexpected/);
});

test("throws a distinct transient error on 429 without retrying or leaking the body", async () => {
  const calls: string[] = [];
  const fetcher = (async () => {
    calls.push("called");
    return new Response("secret error body", { status: 429 });
  }) as unknown as typeof fetch;

  await assert.rejects(evaluate(noulRequest, { fetcher, apiKey: KEY }), (error: unknown) => {
    assert.ok(error instanceof JevTransientError);
    assert.equal(error.status, 429);
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("reports other HTTP statuses without the response body", async () => {
  const fetcher = (async () => new Response("secret error body", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(evaluate(noulRequest, { fetcher, apiKey: KEY }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "TypeSafe HTTP 500");
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
});

test("throws a clear error when no API key is available", async () => {
  const previous = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    const { fetcher } = fakeFetch({ model: "x", answers: {} });
    await assert.rejects(evaluate(noulRequest, { fetcher }), /TYPESAFE_API_KEY/);
  } finally {
    if (previous !== undefined) process.env.TYPESAFE_API_KEY = previous;
  }
});

test("rejects an invalid score question before calling the network", async () => {
  const { fetcher, calls } = fakeFetch({});
  const request = {
    state: "x",
    questions: { rate: { type: "score", instructions: "Rate", criteria: ["only"] } },
  } as unknown as JevRequest;
  await assert.rejects(evaluate(request, { fetcher, apiKey: KEY }), /2-10 score levels/);
  assert.equal(calls.length, 0);
});
