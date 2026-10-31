/** Fixed HTTPS endpoint; redirected responses are rejected. */
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_MODEL = "jev-latest";
const MAX_REQUEST_BYTES = 262_144, MAX_RESPONSE_BYTES = 1_048_576, MAX_QUESTIONS = 128;
const INVALID = "TypeSafe returned an invalid typed response";
/** A received HTTP 429/529. Never retried here; the caller decides. */
export class JevTransientError extends Error {
    status;
    constructor(status) {
        super(`TypeSafe HTTP ${status}: transient failure; not retried`);
        this.status = status;
        this.name = "JevTransientError";
    }
}
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const has = (v, key) => Object.prototype.hasOwnProperty.call(v, key);
const probability = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
function checkQuestion(id, q) {
    const label = `Invalid question "${id}"`;
    if (!isObject(q) || !("instructions" in q))
        throw new Error(label);
    if (q.type === "noul")
        return;
    if (q.type === "choice" && isObject(q.criteria) && Object.keys(q.criteria).length > 0)
        return;
    if (q.type === "score" && Array.isArray(q.criteria) &&
        q.criteria.length >= 2 && q.criteria.length <= 10)
        return;
    throw new Error(`${label}: use named choice options, noul, or 2-10 score levels`);
}
function checkRequest(request) {
    if (!isObject(request) || !isObject(request.questions))
        throw new Error("Invalid Jev request: state and questions are required");
    const ids = Object.keys(request.questions);
    if (ids.length < 1 || ids.length > MAX_QUESTIONS)
        throw new Error(`Invalid Jev request: provide 1-${MAX_QUESTIONS} questions`);
    for (const id of ids)
        checkQuestion(id, request.questions[id]);
    if (request.model !== undefined && (typeof request.model !== "string" || !request.model))
        throw new Error("Invalid Jev request: model must be a non-empty string");
}
function serialize(request, model) {
    let body;
    try {
        body = JSON.stringify({ model, state: request.state, questions: request.questions });
    }
    catch {
        throw new Error("Invalid Jev request: state must be JSON-serializable");
    }
    if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES)
        throw new Error(`Invalid Jev request: exceeds ${MAX_REQUEST_BYTES} bytes`);
    return body;
}
function parseUsage(value) {
    if (value === undefined)
        return undefined;
    const { input_tokens: input, output_tokens: output } = isObject(value) ? value : {};
    if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0)
        throw new Error(`${INVALID}: malformed usage`);
    return { input_tokens: input, output_tokens: output };
}
function parseChoiceProbabilities(id, value, criteria) {
    if (!isObject(value) || Object.keys(value).length === 0)
        throw new Error(`${INVALID}: answer "${id}" has malformed probabilities`);
    const probabilities = {};
    for (const [key, p] of Object.entries(value)) {
        if (!has(criteria, key) || !probability(p))
            throw new Error(`${INVALID}: answer "${id}" has malformed probabilities`);
        probabilities[key] = p;
    }
    return probabilities;
}
function parseScoreProbabilities(id, value, levels) {
    if (Array.isArray(value)) {
        if (value.length === levels && value.every((p) => probability(p)))
            return value;
    }
    else if (isObject(value) && Object.keys(value).length === levels) {
        const probabilities = [];
        for (let i = 0; i < levels; i++) {
            const p = value[String(i)];
            if (!probability(p))
                break;
            probabilities.push(p);
        }
        if (probabilities.length === levels)
            return probabilities;
    }
    throw new Error(`${INVALID}: answer "${id}" has malformed probabilities`);
}
function parseResponse(payload, request) {
    if (!isObject(payload) || typeof payload.model !== "string" || !isObject(payload.answers))
        throw new Error(INVALID);
    const ids = Object.keys(request.questions);
    const source = payload.answers;
    if (Object.keys(source).length !== ids.length || !ids.every((id) => has(source, id)))
        throw new Error(`${INVALID}: missing or unexpected answer ids`);
    const answers = {};
    for (const id of ids) {
        const question = request.questions[id];
        const answer = source[id];
        if (!isObject(answer) || answer.type !== question.type)
            throw new Error(`${INVALID}: answer "${id}" has the wrong type`);
        const confidence = answer.confidence;
        if (confidence !== undefined && !probability(confidence))
            throw new Error(`${INVALID}: answer "${id}" has a malformed confidence`);
        if (question.type === "noul") {
            if (!probability(answer.noul))
                throw new Error(`${INVALID}: answer "${id}" has a malformed noul`);
            answers[id] = { type: "noul", noul: answer.noul };
        }
        else if (question.type === "choice") {
            if (typeof answer.choice !== "string" || !has(question.criteria, answer.choice))
                throw new Error(`${INVALID}: answer "${id}" has a malformed choice`);
            const parsed = { type: "choice", choice: answer.choice };
            if (confidence !== undefined)
                parsed.confidence = confidence;
            if (answer.probabilities !== undefined)
                parsed.probabilities = parseChoiceProbabilities(id, answer.probabilities, question.criteria);
            answers[id] = parsed;
        }
        else {
            if (typeof answer.score !== "number" || !Number.isFinite(answer.score) ||
                answer.score < 0 || answer.score > question.criteria.length - 1)
                throw new Error(`${INVALID}: answer "${id}" has a malformed score`);
            const parsed = { type: "score", score: answer.score };
            if (confidence !== undefined)
                parsed.confidence = confidence;
            if (answer.probabilities !== undefined)
                parsed.probabilities = parseScoreProbabilities(id, answer.probabilities, question.criteria.length);
            answers[id] = parsed;
        }
    }
    const usage = parseUsage(payload.usage);
    return usage === undefined ? { model: payload.model, answers } : { model: payload.model, answers, usage };
}
/**
 * Sends one typed System One request and returns its validated response.
 * The API key defaults to TYPESAFE_API_KEY and is never logged or returned.
 */
export async function evaluate(request, opts = {}) {
    checkRequest(request);
    const apiKey = (opts.apiKey ?? process.env.TYPESAFE_API_KEY)?.trim();
    if (!apiKey)
        throw new Error("TypeSafe API key is missing: set TYPESAFE_API_KEY or pass opts.apiKey");
    const body = serialize(request, opts.model ?? request.model ?? DEFAULT_MODEL);
    let response;
    try {
        response = await (opts.fetcher ?? fetch)(JEV_ENDPOINT, {
            method: "POST",
            redirect: "error",
            signal: opts.signal,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body,
        });
    }
    catch {
        // Never surface the fetcher error: it can carry request headers.
        throw new Error(opts.signal?.aborted ? "TypeSafe request aborted" : "TypeSafe request failed");
    }
    if (!response.ok) {
        // The body is never read or surfaced; only the status leaves this function.
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 429 || response.status === 529)
            throw new JevTransientError(response.status);
        throw new Error(`TypeSafe HTTP ${response.status}`);
    }
    let text;
    try {
        text = await response.text();
    }
    catch {
        throw new Error(opts.signal?.aborted ? "TypeSafe request aborted" : "TypeSafe response failed");
    }
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES)
        throw new Error(`${INVALID}: oversized response`);
    let payload;
    try {
        payload = JSON.parse(text);
    }
    catch {
        throw new Error(INVALID);
    }
    return parseResponse(payload, request);
}
