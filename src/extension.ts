import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { EntryType } from "./types.js";
import { evaluate } from "./client.js";

// client.ts checkQuestion is the runtime EntryType authority. TypeBox recursion is not
// portable here: Type.Cyclic emits $defs, which some Pi providers strip.
const EntryType = Type.Unsafe<EntryType>(
  Type.Any({ description: "EntryType: string, number, boolean, null, array or object." }),
);

const NoulCriteria = Type.Object({
  true: Type.Optional(EntryType),
  false: Type.Optional(EntryType),
});

const Question = Type.Union([
  Type.Object({ type: Type.Literal("choice"), instructions: EntryType, criteria: Type.Record(Type.String(), EntryType) }),
  Type.Object({ type: Type.Literal("noul"), instructions: EntryType, criteria: Type.Optional(NoulCriteria) }),
  Type.Object({ type: Type.Literal("score"), instructions: EntryType, criteria: Type.Array(EntryType, { minItems: 2, maxItems: 10 }) }),
]);

export default function (pi: ExtensionAPI): void {
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
      const response = await evaluate(
        { state: params.state, questions: params.questions, model: params.model },
        { signal },
      );
      return { content: [{ type: "text", text: JSON.stringify(response) }], details: response };
    },
  }));
}
