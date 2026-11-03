export function makeDecisionApi(request) {
  return {
    decision: async signal => {
      const result = await request("decision/", "GET", null, true, false, true, signal);
      if (result?.type !== "success" || !Array.isArray(result.cards) || !Array.isArray(result.mustKnow)) {
        throw new Error(result?.message || "Market summary unavailable.");
      }
      return result;
    },
    // Today's five-minute candles for the index future of the chosen contract month.
    candles: async (index, contract, signal) => {
      const query = new URLSearchParams({ index, contract }).toString();
      const result = await request(`market/candles/?${query}`, "GET", null, true, false, true, signal);
      if (result?.type !== "success" || !Array.isArray(result.candles)) throw new Error(result?.message || "Candles unavailable.");
      return result;
    },
  };
}
