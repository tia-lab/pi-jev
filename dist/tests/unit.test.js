import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MODEL, JEV_ENDPOINT, JevTransientError, evaluate } from "../src/index.js";
const KEY = "test-key";
function fakeFetch(payload, status = 200) {
    const calls = [];
    const fetcher = (async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify(payload), {
            status,
            headers: { "content-type": "application/json" },
        });
    });
    return { fetcher, calls };
}
const noulRequest = {
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
    const headers = calls[0]?.init.headers;
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
    const request = {
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
test("accepts structured EntryType instructions and criteria", async () => {
    const { fetcher, calls } = fakeFetch({
        model: "jev-1.14.0",
        answers: {
            noul: { type: "noul", noul: 0.7 },
            pick: { type: "choice", choice: "a" },
            rate: { type: "score", score: 1 },
        },
    });
    const request = {
        state: { summary: "ship" },
        questions: {
            noul: {
                type: "noul",
                instructions: { goal: "ship", signals: ["tests", { green: true }], weight: 0.5, none: null },
                criteria: { true: { label: "yes" }, false: ["no", { reason: "risk" }] },
            },
            pick: {
                type: "choice",
                instructions: ["pick", { mode: "safe" }],
                criteria: { a: { label: "A", rank: 1 }, b: null },
            },
            rate: {
                type: "score",
                instructions: { rubric: "risk", scale: { low: 0, high: 2 } },
                criteria: [{ label: "low", value: 0 }, "medium", null],
            },
        },
    };
    const response = await evaluate(request, { fetcher, apiKey: KEY });
    const body = JSON.parse(String(calls[0]?.init.body));
    assert.deepEqual(body.questions, request.questions);
    assert.deepEqual(response.answers, {
        noul: { type: "noul", noul: 0.7 },
        pick: { type: "choice", choice: "a" },
        rate: { type: "score", score: 1 },
    });
});
test("rejects a missing answer instead of returning a partial response", async () => {
    const { fetcher } = fakeFetch({ model: "jev-1.14.0", answers: {} });
    await assert.rejects(evaluate(noulRequest, { fetcher, apiKey: KEY }), /invalid typed response/);
});
test("rejects missing instructions and empty choice criteria", async () => {
    const { fetcher, calls } = fakeFetch({});
    const missing = {
        state: "x",
        questions: { q: { type: "noul" } },
    };
    await assert.rejects(evaluate(missing, { fetcher, apiKey: KEY }), /Invalid question/);
    const empty = {
        state: "x",
        questions: { q: { type: "choice", instructions: "Pick", criteria: {} } },
    };
    await assert.rejects(evaluate(empty, { fetcher, apiKey: KEY }), /named choice options/);
    assert.equal(calls.length, 0);
});
test("rejects malformed answer types and fields", async () => {
    const wrongType = fakeFetch({ model: "jev-1.14.0", answers: { green: { type: "score", score: 1 } } });
    await assert.rejects(evaluate(noulRequest, { fetcher: wrongType.fetcher, apiKey: KEY }), /wrong type/);
    const outOfRange = fakeFetch({ model: "jev-1.14.0", answers: { green: { type: "noul", noul: 1.5 } } });
    await assert.rejects(evaluate(noulRequest, { fetcher: outOfRange.fetcher, apiKey: KEY }), /malformed noul/);
    const choice = fakeFetch({ model: "jev-1.14.0", answers: { pick: { type: "choice", choice: "z" } } });
    const choiceRequest = {
        state: "x",
        questions: { pick: { type: "choice", instructions: "Pick", criteria: { a: "first" } } },
    };
    await assert.rejects(evaluate(choiceRequest, { fetcher: choice.fetcher, apiKey: KEY }), /malformed choice/);
});
test("rejects a non-JSON body and unexpected answer ids", async () => {
    const invalidJson = (async () => new Response("not json", { status: 200 }));
    await assert.rejects(evaluate(noulRequest, { fetcher: invalidJson, apiKey: KEY }), /invalid typed response/);
    const extra = fakeFetch({
        model: "jev-1.14.0",
        answers: { green: { type: "noul", noul: 0.5 }, other: { type: "noul", noul: 0.5 } },
    });
    await assert.rejects(evaluate(noulRequest, { fetcher: extra.fetcher, apiKey: KEY }), /missing or unexpected/);
});
test("throws a distinct transient error on 429 without retrying or leaking the body", async () => {
    const calls = [];
    const fetcher = (async () => {
        calls.push("called");
        return new Response("secret error body", { status: 429 });
    });
    await assert.rejects(evaluate(noulRequest, { fetcher, apiKey: KEY }), (error) => {
        assert.ok(error instanceof JevTransientError);
        assert.equal(error.status, 429);
        assert.doesNotMatch(error.message, /secret/);
        return true;
    });
    assert.equal(calls.length, 1);
});
test("reports other HTTP statuses without the response body", async () => {
    const fetcher = (async () => new Response("secret error body", { status: 500 }));
    await assert.rejects(evaluate(noulRequest, { fetcher, apiKey: KEY }), (error) => {
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
    }
    finally {
        if (previous !== undefined)
            process.env.TYPESAFE_API_KEY = previous;
    }
});
test("rejects an invalid score question before calling the network", async () => {
    const { fetcher, calls } = fakeFetch({});
    const request = {
        state: "x",
        questions: { rate: { type: "score", instructions: "Rate", criteria: ["only"] } },
    };
    await assert.rejects(evaluate(request, { fetcher, apiKey: KEY }), /2-10 score levels/);
    assert.equal(calls.length, 0);
});
test("rejects more than 10 score levels before calling the network", async () => {
    const { fetcher, calls } = fakeFetch({});
    const request = {
        state: "x",
        questions: {
            rate: {
                type: "score",
                instructions: "Rate",
                criteria: Array.from({ length: 11 }, (_, i) => ({ level: i })),
            },
        },
    };
    await assert.rejects(evaluate(request, { fetcher, apiKey: KEY }), /2-10 score levels/);
    assert.equal(calls.length, 0);
});
test("rejects circular, oversized and over-count requests before the network", async () => {
    const { fetcher, calls } = fakeFetch({});
    const circular = {};
    circular.self = circular;
    const circularRequest = {
        state: circular,
        questions: { q: { type: "noul", instructions: "x" } },
    };
    await assert.rejects(evaluate(circularRequest, { fetcher, apiKey: KEY }), /JSON-serializable/);
    const oversized = {
        state: "x".repeat(262_144),
        questions: { q: { type: "noul", instructions: "x" } },
    };
    await assert.rejects(evaluate(oversized, { fetcher, apiKey: KEY }), /exceeds 262144 bytes/);
    const questions = {};
    for (let i = 0; i < 129; i++)
        questions[`q${i}`] = { type: "noul", instructions: "x" };
    await assert.rejects(evaluate({ state: "x", questions }, { fetcher, apiKey: KEY }), /1-128 questions/);
    assert.equal(calls.length, 0);
});
