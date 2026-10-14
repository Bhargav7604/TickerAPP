# Equity Market Watch

The `#equity` section is read-only. It exposes NSE stock futures and stock
options from the Zerodha instrument catalogue. It has no cash-share quotes,
index derivatives, order endpoints, positions, funds, or trading controls.
FYERS is not used by this section.

## Data and Authentication

- Existing application login and account-validity checks protect all three GET
  endpoints: `/api/equity/contracts/`, `/api/equity/quotes/`, and
  `/api/equity/history/`.
- The server uses the existing shared `KiteSettings` session. API keys and access
  tokens are never included in Equity responses.
- Stock membership is identified while reading the full instrument master:
  NFO FUT/CE/PE instruments must have an underlying also listed as an NSE EQ
  instrument. Cash instruments are used only for this classification.
- Expired instruments and instruments with invalid lot sizes are excluded.
  Current/Next/Far select the first three listed future expiries per stock.
- Quotes refresh every four seconds, not tick-by-tick. Five-minute chart data
  refreshes every minute for the current IST session, 09:15-15:30.
- Volume, OI, and depth quantity are divided by each contract's own lot size.
  Missing quotes remain unavailable rather than becoming zero or sample data.
- Quotes require working Kite market-data access; charts also require historical
  data access. Refresh the broker session in admin after token expiry.

## Instrument Refresh

The existing `run_market_feed` worker refreshes the instrument catalogue on
startup and at 08:30 IST. After deploying this change, restart that worker or
refresh the catalogue once so it gains the `stock_derivative` marker and stock
option rows:

```sh
python manage.py shell -c 'from backend.master_contract_updater import fetch_master_contract; fetch_master_contract()'
```

The old catalogue deliberately produces an empty Equity list until refreshed.
The existing index subscription resolver still selects only its index tokens.

## Bounds and Storage

- A watchlist supports 50 contracts; a browser/account supports ten watchlists.
  Watchlists, row order, desktop columns, and depth visibility are browser-local,
  scoped to the signed-in username. They do not sync across devices.
- All Futures is paginated at 49 rows, reserving one quote slot for a separately
  selected contract. Numeric sorting applies to the displayed page.
- Stock Options is a separate catalogue browser, not a watchlist filter. Stock,
  expiry, strike and call/put selectors are populated from listed contracts.
  Changing stock resets expiry and strike; changing expiry resets strike.
  Browsing does not add contracts to a watchlist. The plus button still does.
- `contracts/?kind=options` returns selector metadata and a 49-contract page.
  Optional filters are `underlying`, ISO `expiry`, numeric `strike`,
  `option_type=all|CE|PE`, and zero-based `page`. Invalid filters are rejected.
- Contract search returns at most 50 matches. Narrow a query by symbol, contract
  month, strike, and/or CE/PE. Saved contract hydration is limited to 50 IDs.
- Cross-worker REST caches use existing `LiveMarketFeed` rows 2 (quotes) and 3
  (history). Row 1 remains exclusively owned by the existing index feed.
- Cache leases serialize broker calls per endpoint, with a 1.1-second cooldown
  after success and five seconds after failure. Quote TTL is three seconds;
  history TTL is sixty seconds. Each cache retains at most 500 entries, drops
  entries older than ten minutes, and isolates credential rotations.
- When quotes or history are pending behind a lease, responses include
  `retryAfterMs` (250-1500 ms). The frontend adds a small random delay before
  retrying, avoiding synchronized four-second retries that repeatedly miss the
  available slot. Broker calls still obey the shared cooldown. Partial quotes
  remain visible; an explicit missing broker quote is not a perpetual wait.
- Refreshing retains a selected searched contract even when it is not saved
  in a watchlist. Aborted responses cannot replace a newer selection.
- No database migration was added, so this feature does not depend on the
  currently local-only FYERS migration.

## Local Visual Review

Normal builds and the normal authenticated route use real API data only.
To enable the isolated sample-data preview locally:

```sh
cd frontend/gui
npm ci --legacy-peer-deps
REACT_APP_DESIGN_PREVIEW=true npm run build
```

Open `http://127.0.0.1:8008/?preview=design#equity`. This preview is labelled
Sample data, uses separate browser preferences, and does not call broker APIs.
Do not enable the preview flag for a production build.

For the authenticated page, use `http://127.0.0.1:8008/#equity`.

## Verification

```sh
python manage.py test backend --noinput
cd frontend/gui
CI=true npm test -- --watchAll=false --runInBand
CI=true npm run build
```

Live quotes and historical candles still need an end-to-end check after the
local Zerodha session is renewed. The local review on 12 October 2026 received
`TokenException` from a read-only quote request; no credentials were changed.

The options-browser follow-up on the same date passed 70 backend tests and
52 frontend tests, including filter/pagination isolation, late-response guards,
partial-quote cooldown retries, chart retries and selected-contract refresh.
The real local catalogue returned 213 option underlyings, three RELIANCE
expiries, 48 current-expiry strikes and 96 call/put contracts across two pages.
Desktop and 390px mobile controls were checked with the labelled sample-data
preview; the mobile page had no horizontal overflow. A renewed local broker
session is still required for live quote verification.
