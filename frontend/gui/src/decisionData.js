export function makeDecisionApi(request) {
  return {
    decision: async signal => {
      const result = await request("decision/", "GET", null, true, false, true, signal);
      if (result?.type !== "success" || !Array.isArray(result.cards) || !Array.isArray(result.mustKnow)) {
        throw new Error(result?.message || "Market summary unavailable.");
      }
      return result;
    },
  };
}
