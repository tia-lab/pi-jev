import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { evaluate } from "./client.js";
const Question = Type.Union([
    Type.Object({ type: Type.Literal("choice"), instructions: Type.String(), criteria: Type.Record(Type.String(), Type.String()) }),
    Type.Object({ type: Type.Literal("noul"), instructions: Type.String() }),
    Type.Object({ type: Type.Literal("score"), instructions: Type.String(), criteria: Type.Array(Type.String(), { minItems: 2, maxItems: 10 }) }),
]);
export default function (pi) {
    pi.registerTool(defineTool({
        name: "jev_evaluate",
        label: "TypeSafe evaluate",
        description: "Send one typed System One request to TypeSafe and return validated answers for every question id.",
        parameters: Type.Object({
            state: Type.Unknown({ description: "JSON state the questions judge." }),
            questions: Type.Record(Type.String(), Question, { minProperties: 1, maxProperties: 128 }),
            model: Type.Optional(Type.String()),
        }),
        async execute(_toolCallId, params, signal) {
            const response = await evaluate({ state: params.state, questions: params.questions, model: params.model }, { signal });
            return { content: [{ type: "text", text: JSON.stringify(response) }], details: response };
        },
    }));
}
