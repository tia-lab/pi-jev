import type { EvaluateOptions, JevRequest, JevResponse } from "./types.js";
/** Fixed HTTPS endpoint; redirected responses are rejected. */
export declare const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export declare const DEFAULT_MODEL = "jev-latest";
/** A received HTTP 429/529. Never retried here; the caller decides. */
export declare class JevTransientError extends Error {
    readonly status: number;
    constructor(status: number);
}
/**
 * Sends one typed System One request and returns its validated response.
 * The API key defaults to TYPESAFE_API_KEY and is never logged or returned.
 */
export declare function evaluate(request: JevRequest, opts?: EvaluateOptions): Promise<JevResponse>;
