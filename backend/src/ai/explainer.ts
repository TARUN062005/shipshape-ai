import { createBharatCodeExplainer, type BharatCodeOptions } from "./bharatcode.js";
import type { AiExplanation, ExplainInput } from "../types.js";

export interface FindingExplainer {
  explain(input: ExplainInput): Promise<AiExplanation>;
}

/**
 * Used when BHARATCODE_API_KEY is absent. It does not call the network.
 * Static findings are unchanged.
 */
export function createDeferredExplainer(): FindingExplainer {
  return {
    async explain(_input: ExplainInput): Promise<AiExplanation> {
      return {
        available: false,
        model: null,
        summary: null,
        remediations: [],
        reason: "BharatCode is not configured. Set BHARATCODE_API_KEY on the server to enable explanations.",
      };
    },
  };
}

/** BharatCode when a key is configured, and the deferred explainer when it is not. */
export function createFindingExplainer(options: BharatCodeOptions): FindingExplainer {
  if (!options.apiKey) return createDeferredExplainer();
  return createBharatCodeExplainer(options);
}
