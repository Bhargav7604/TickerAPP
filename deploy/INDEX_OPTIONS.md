# Index Options

The separate **Index Options** section (`/#index-options`) browses Nifty and
Bank Nifty options on NFO and Sensex options on BFO. Equity remains stock-only;
the existing Index futures dashboard is unchanged. This is read-only, with no
order-placement endpoints or controls.

- Index, expiry date, strike and Calls/Puts filters use the daily broker
  instrument catalogue, including available weekly and longer-dated expiries.
  Expired contracts and zero-lot-size entries are excluded.
- Prices, five-level depth, volume and OI use the selected contract's exchange
  identifier and lot size. Charts use five-minute candles for today's session.
- Index watchlists and column preferences are stored separately from Equity
  preferences in the user's browser. Watchlist labels include the expiry day.
- Authenticated GET endpoints: `/api/index-options/contracts/`,
  `/api/index-options/quotes/`, `/api/index-options/history/`.
- These endpoints use the existing Zerodha admin connection and share the
  Equity REST cache and rate-limit cooldown. A fresh broker session and relevant
  market-data access are required. Missing quotes are never replaced by samples.
- The existing instrument updater already retains these index options. No new
  migration or FYERS integration is required.

For local visual checks only, a build with `REACT_APP_DESIGN_PREVIEW=true` exposes
`/?preview=design#index-options`, explicitly labelled **Sample data**. Production
builds must leave this flag disabled.
