/** Wire types for the TypeSafe System One API. No runtime behavior lives here. */
/** Structured JSON value accepted by System One for instructions and criteria descriptions. */
export type EntryType = string | number | boolean | null | EntryType[] | {
    [key: string]: EntryType;
};
export interface ChoiceQuestion {
    type: "choice";
    instructions: EntryType;
    criteria: Record<string, EntryType>;
}
export interface NoulQuestion {
    type: "noul";
    instructions: EntryType;
    criteria?: {
        true?: EntryType;
        false?: EntryType;
    };
}
export interface ScoreQuestion {
    type: "score";
    instructions: EntryType;
    criteria: EntryType[];
}
export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion;
export interface NoulAnswer {
    type: "noul";
    noul: number;
}
export interface ChoiceAnswer {
    type: "choice";
    choice: string;
    confidence?: number;
}
export interface ScoreAnswer {
    type: "score";
    score: number;
    confidence?: number;
}
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
export interface JevRequest {
    state: unknown;
    questions: Record<string, Question>;
    model?: string;
}
export interface JevUsage {
    input_tokens: number;
    output_tokens: number;
}
export interface JevResponse {
    model: string;
    answers: Record<string, Answer>;
    usage?: JevUsage;
}
export interface EvaluateOptions {
    signal?: AbortSignal;
    apiKey?: string;
    model?: string;
    fetcher?: typeof fetch;
}
