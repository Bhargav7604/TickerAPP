# Index Tool: Scan Table Design QA

## Targets
- Desktop: `/Users/ayuschpratyush/.codex/generated_images/019dd92a-9bd7-77a0-900e-c36b58f5066c/exec-08de5cbb-a4c9-43c6-b60c-b522c3db9e08.png`
- Mobile: `/Users/ayuschpratyush/.codex/generated_images/019dd92a-9bd7-77a0-900e-c36b58f5066c/exec-e0c21bd0-6515-4927-99ee-a1a75458fdb0.png`
- Local implementation: `http://127.0.0.1:8008/?preview=design`
- Live-data frontend: `http://127.0.0.1:8008/`

## Comparison History
1. Desktop full-view paired comparison: selected image and `/private/tmp/index-tool-desktop-first.jpg`, 1440 CSS px wide. Initial implementation was too tall: chart and table spacing pushed the snapshot preview and AC/DD strip below the intended viewport. P2. Reduced spacing, adjusted first nine metric widths, and shortened chart without shrinking its text.
2. Mobile first capture `/private/tmp/index-tool-mobile-first.jpg`, 390 x 844 CSS px. P2: price-axis labels could overflow left; widened the fixed left axis and rounded axis labels only (sample values retain precision).
3. Touch/keyboard-selected mobile capture showed an inherited legacy grid rule putting lot counts on a separate row. P2: explicitly assigned time, description and lot count to the same grid row. Final mobile capture verifies single-line time and aligned lot counts.
4. Desktop chart originally had only a selected-sample readout. Added the mockup's floating hover tooltip; mobile keeps the non-obscuring persistent readout.
5. Final paired visual comparisons reviewed the selected desktop image beside `/private/tmp/index-tool-desktop-final.jpg`, and the selected mobile image beside `/private/tmp/index-tool-mobile-final.jpg`. No remaining blocking visual issues found.

## Final Evidence
- Desktop: `/private/tmp/index-tool-desktop-final.jpg`, 1440 x 1024 CSS viewport, DPR 1, full-page capture. Source is 1487 x 1058 pixels; compare proportionally at 1440 px width (scale 0.9684), not raw pixel coordinates.
- Mobile: `/private/tmp/index-tool-mobile-final.jpg`, 390 x 844 CSS viewport, DPR 1. Source is 853 x 1844 pixels; compare proportionally at 390 px width (scale 0.4572).
- Additional narrow-screen check: `/private/tmp/index-tool-mobile-320.jpg`, 320 CSS px wide.
- State: Current month, Nifty, Net lots, Last 60 min; isolated sample session 09 Oct 2026 at 14:35 IST, selected chart sample 14:05. Waveforms and lot sizes intentionally use the fixture/contract data rather than generated-image numbers.

## Fidelity Surfaces
- Layout: preserves the horizontal comparison table, blue month pills, desktop chart/activity split and mobile stacked chart/activity. Extra metrics scroll inside the table; the page itself does not overflow at 320, 390 or 1440 px.
- Typography: retains the existing application font, bold primary metrics and alert descriptions, tabular numeric alignment, compact headings and readable secondary labels. Mobile contract labels are shortened to the month; full symbols remain in activity rows and accessible titles.
- Color: white and pale neutral surfaces, blue active navigation and index line, orange net-lot line, green/red signed values. Selected rows and active tabs match the selected design's hierarchy.
- Assets: retains the existing Q brand mark, uses Lucide UI icons, and renders the actual dynamic SVG chart. No decorative placeholders or generated raster UI are used in the application.
- Copy/data: all three expiry months and indices remain supported. Correct units and real data availability take precedence over generated-image labels. Existing ratio mode, settings and full-session history remain available. Alert thresholds are still managed in Settings, not through an unsaved decorative input.

## Product Constraints
- Mock data is isolated behind `REACT_APP_DESIGN_PREVIEW=true` plus `?preview=design`. It does not mount the real App, call broker APIs, save settings or send alerts. Normal builds omit the preview. The ordinary URL always uses real authentication and API data.
- Snapshot storage currently has futures level, net lots and ratio, not historical spot. The preview table therefore does not invent historical spot quotes.
- Corrected generated mockup units: away from VWAP is points, net lots is lots. Lot size comes from contract metadata in the live app, not hard-coded mock values.
- Five-minute sampling and full-session history remain intact. The initial chart window is Last 60 min, with Full day 09:00-15:30 available.

## Verification
- 23 frontend tests passed across 3 suites, including eight dashboard tests covering month/index selection, full-session history, keyboard tabs, chart pointer/keyboard selection, five-minute ticks, ratio mode and offline values.
- Standard production build compiled successfully and excluded the demo fixture module. The subsequent opt-in local preview build also compiled successfully.
- Browser checks passed for Current/Next/Far, all indices, chart sample inspection, full-session snapshots, settings navigation and the authenticated real-data page. No browser console errors observed.
- Body width matched the viewport at 320, 390 and 1440 px. Five-minute plot scrolling and the overflow metrics table are intentional internal scrollers.
- No backend changes were made for this redesign. Existing unrelated/uncommitted work was preserved. Nothing was committed or pushed.

## Remaining Limitations
- The broker session returns 403 and must be refreshed before checking fresh live quotes. The populated preview uses clearly labelled sample data and never sends real email alerts or persists settings.
- Native select styling and the existing font are retained rather than reproducing image-generator glyphs exactly. The snapshot preview omits unavailable historical spot data; full session history remains accessible through its tab.

final result: passed

## Configurable Market Overview Follow-up
- Added a column selector beside the expiry pills with individual checkboxes, Essentials, Select all and Reset to default. Index/Symbol stays visible; at least one metric is required.
- Preferences are saved per authenticated account through `settings/columns/` and returned by the normal settings endpoint. This write changes no alert, broker or contract-month settings. Migration `0019_user_market_columns` was applied locally.
- The initial eight-metric view fits a 1440 px desktop viewport without horizontal scrolling. Selected columns render consistently on mobile, including Spot; no hidden mobile-only metric rule overrides the user's choice. Essentials fits a 390 px phone.
- Preview preferences use a separate local preview-only key and do not touch any real account. Real-account saving and persistence after reload were also verified in the browser, then the account's default view was restored.
- Verified empty-selection prevention, reset, cancel/Escape, focus restoration, failed-save retry, stale-response protection, invalid API payloads, account isolation and preservation of unrelated settings.
- Evidence: `/private/tmp/index-tool-columns-desktop.jpg`, `/private/tmp/index-tool-columns-mobile.jpg`, `/private/tmp/index-tool-columns-mobile-essentials.jpg`, `/private/tmp/index-tool-columns-mobile-320.jpg`.
- Backend: 30 tests passed. Frontend: 31 tests passed. Build compiled successfully; migration check and diff whitespace check passed. No browser console errors observed.
- A narrow-phone fieldset overflow issue found during visual QA was fixed with a dedicated scrolling body; dialog actions remain visible. Nothing committed or pushed.

## Market Overview Spacing Follow-up
- Removed forced full-width table expansion. The comparison section now follows its content width, capped at the viewport, with scrolling confined to the table when needed.
- Reduced desktop cell padding from 22 px to 12 px and tightened metric widths. Typography, row height, numeric alignment and saved column preferences are unchanged.
- At 1440 px with Essentials, Index/Symbol reduced from 526.8 px to 184 px and Futures from 316.1 px to 110 px. The complete default selection is 1008 px wide.
- Checked Essentials, default and all 12 metrics. No clipped cells or page overflow at desktop/phone widths; all-column horizontal scrolling remains available. Evidence: `/private/tmp/index-tool-spacing-essentials.jpg`, `/private/tmp/index-tool-spacing-default.jpg`, `/private/tmp/index-tool-spacing-mobile.jpg`.
- Frontend regression tests: 31 passed. Local build compiled successfully. No commit or push.

## Equity Market Watch: 12 October 2026

### Source and Evidence
- Selected Option 1: `/Users/ayuschpratyush/.codex/generated_images/019dd92a-9bd7-77a0-900e-c36b58f5066c/exec-07a8460a-4a5a-40c6-baff-757cef098aa1.png`.
- Refined visual target with collapsible depth: `/Users/ayuschpratyush/.codex/generated_images/019dd92a-9bd7-77a0-900e-c36b58f5066c/exec-f29b1a8b-e068-4b7e-ba63-b2ba4dcd6393.png` (1639 x 960 board).
- Implementation: `http://127.0.0.1:8008/?preview=design#equity`.
- Screenshot directory: `/Users/ayuschpratyush/.codex/visualizations/2026/04/29/019dd92a-9bd7-77a0-900e-c36b58f5066c/`.
- Desktop: `equity-desktop-final.jpg`, 1440 x 1024 image and CSS viewport; `equity-desktop-depth.jpg` shows the expanded state.
- Mobile: `equity-mobile-final.jpg`, `equity-mobile-depth.jpg`, and `equity-mobile-depth-chart.jpg`, each 390 x 844 image and CSS viewport. `equity-mobile-320-columns.jpg` records the narrow settings dialog.
- State: sample current-month stock futures plus Reliance CE/PE, 12 Oct 2026, 11:25 IST. No actual trades or orders.
- Density normalization: the source is a board with desktop and phone content regions, not a raw browser capture. Compare its approximately 1226 px desktop region proportionally to the 1440 px capture, and its 346 px phone region to the 390 px capture. Ignore board margins and labels. Final captures use a fresh tab with a 1x CSS screenshot; earlier browser-zoom-distorted captures were excluded from acceptance.

### Comparison History
1. Initial combined source/desktop comparison found P2 numeric misalignment from inherited table selectors. Added more specific right-alignment rules for numeric header and data cells. Final captures show consistent right edges.
2. Initial P2 density mismatch: row-action padding expanded rows and pushed most of the chart below the desktop fold. Reduced padding without reducing type size, combined the desktop command row, and set a compact 170 px plot. The final 1440 x 1024 capture includes all ten sample rows and the entire chart.
3. Initial P2 mobile interaction issue: opening depth put its top at 790 px, underneath the bottom navigation. The expanded mobile list is now capped at 262 px; depth starts at 572 px. `equity-mobile-depth.jpg` shows immediate visible feedback, and the subsequent scrolled capture shows depth plus the chart.
4. Chart resize initially left an unnecessary blank span. Added ResizeObserver-driven fitContent; revised desktop/mobile chart captures have a nonblank, properly framed time series.
5. Final combined inputs displayed the refined source board together with the final desktop and mobile captures. Focused readable regions were also reviewed in the expanded depth/chart captures and by DOM alignment/overflow measurements. No actionable P0/P1/P2 visual findings remain.

### Fidelity Surfaces
- Typography: retained the existing system sans-serif, 14 px table values, bold LTP/change, secondary 12 px contract labels, tabular numerals, and zero letter spacing. Mobile prices are 15 px with signed changes beneath. No type shrinking to mask excess spacing.
- Layout: full-width desktop market watch, collapsed/expanded right-side depth, compact chart below, and stacked mobile depth. Collapse expands desktop watch width from 1070 to 1408 px. The phone list is intentionally internally scrollable, with fixed Index/Equity/Settings navigation.
- Colors: white/neutral-gray surfaces, blue navigation/selection/chart, green positive and red negative quotes, pale green/red depth cells. No decorative gradients or oversized cards.
- Assets: preserves the application's existing Q brand and Lucide controls. Price/volume is an actual Lightweight Charts canvas, not a screenshot. TradingView attribution is retained. No stock photography or decorative illustration is appropriate to this operational screen.
- Copy/content: only stock futures/options; no Buy/Sell or order actions. Contract expiry and strike remain visible; lots derive from metadata. Preview labels clearly distinguish sample data from the authenticated API path.

### Intentional Adaptations
- Existing product navigation is retained. Mobile does not duplicate Index/Equity tabs both above and below the screen.
- The detail view includes OHLC, previous close, lot size, and OI, so depth and chart may require vertical scrolling on phones. Collapsing depth returns list space.
- Chart has real five-minute samples and a Today/Last 60/Last 30 range selector; the source's illustrative waveform and inconsistent quote numbers are not reproduced as market data.
- Additional desktop column configuration and named watchlist controls are functional. Desktop metrics collapse to LTP/change on phones; full selected-contract details remain in the depth view.

### Verification and Limits
- 63 backend and 45 frontend tests passed; optimized local build succeeded; Django system check passed.
- Browser-tested depth collapse/expand, mobile tap selection, CE search, add-to-watchlist and persistence after reload, Current/Next/Far, desktop hide/reorder/reset columns, keyboard row reordering, chart range and crosshair readout, and Index/Equity navigation.
- Page width equals viewport width at 320, 390, and 1440 px. The 320 px settings dialog remains within the viewport. No browser warning/error logs observed in the checked tabs.
- Live verification is limited by an expired local Zerodha session (`TokenException`). No sample quotes are substituted on the real route. Production-scale concurrent quote load and physical-device touch behavior remain deployment validation tasks.
- Existing FYERS files/settings were preserved and remain local. No commit or push was made.

### Implementation Checklist
- [x] Selected Market Watch structure implemented for desktop and mobile.
- [x] Bid/ask depth collapses and its preference persists.
- [x] Read-only stock derivatives enforced by authenticated server endpoints.
- [x] Visual fixes recaptured and compared to the selected source.
- [x] Local preview left running for review.
- [ ] Renew the local Zerodha session for live quote/history verification.
- [ ] User approval before any GitHub push; FYERS remains excluded.

final result: passed

## Full-screen Terminal Follow-up (13 Oct 2026)

### Target and Scope
- Main reference: `/var/folders/dn/q3yw15gd0w31ryryw1qfzwmc0000gn/T/codex-clipboard-ea947a44-35ab-498f-ac9a-777b89501350.png`, 1492 x 728 pixels.
- Secondary chart-below reference: `/var/folders/dn/q3yw15gd0w31ryryw1qfzwmc0000gn/T/codex-clipboard-187e947c-4f22-4d8b-af57-bcb655416e23.png`.
- Local preview: `http://127.0.0.1:8008/?preview=design&terminal-preview=4#equity`, then Open terminal view.
- Selected interaction: watchlist fills the screen initially; Chart opens the selected contract beneath it; Close restores the full-height watchlist. Existing Equity/Index Options views remain available through Exit terminal view.
- Read-only derivatives scope remains unchanged. This is a NEST-style market-watch view, not a complete clone of NEST's order management, indicator catalogue, broker menus, or floating index-price window.

### Evidence and Normalization
- All evidence is under `/Users/ayuschpratyush/.codex/visualizations/2026/04/29/019dd92a-9bd7-77a0-900e-c36b58f5066c/`.
- `terminal-desktop-final.jpg` and `terminal-desktop-chart-final.jpg`: 1492 x 728 CSS viewport and output pixels. Device screenshots normalized by the browser to CSS dimensions; no additional scale used for the main comparison.
- `terminal-reference-comparison-final.png`: supplied full-screen reference above the final implementation, each 1492 x 728. `terminal-grid-comparison-final.png`: corresponding 1430 x 190 header/row regions stacked at equal scale for text, alignment and column inspection.
- `terminal-chart-comparison.png`: secondary chart-below reference and implementation normalized to 1462 x 748 each. Recorded before the final legacy scrollbar removal; chart placement and rendering unchanged afterward.
- `terminal-mobile-final.jpg`, `terminal-mobile-chart-final.jpg`: 390 x 844 CSS viewport and image pixels. `terminal-mobile-320-final.jpg`: additional 320 x 680 check, before the root-scrollbar correction. There is no supplied phone reference, so these test responsive functionality rather than exact visual cloning.
- State: labeled sample October stock futures plus Reliance CE/PE; HDFCBANK selected in final captures, chart initially closed. Sample prices and row counts intentionally differ from the reference. Frozen sample quotes do not generate fake uptick/downtick flashes.

### Findings and Iterations
1. P2: inherited mobile grid rules overlapped depth/chart controls and disabled horizontal table scrolling. Corrected scoped toolbar display to flex and restored internal overflow. Final phone captures show separate controls and accessible columns.
2. P2: normal-view saved depth preference could make Terminal open with a reduced-width watchlist. Added independent, initially collapsed Terminal depth state; normal-view preference is restored on exit. Covered by regression test.
3. P2: inherited root `overflow-y: scroll` reserved a 15 px gutter even with the body locked. Scoped root overflow to the full-screen mode. Post-fix measurements at 390 and 1492 px show root client width and Terminal width equal the viewport width.
4. Reordered Exchange before Trading Symbol to follow the main reference; kept the symbol sticky during horizontal scrolling. Reduced the narrow-phone Chart control to an icon with its accessible name and tooltip; all toolbar controls fit at 320 px without overlap.
5. Final combined full-view and focused grid comparisons reviewed after fixes. No remaining blocking findings for the agreed full-screen/watchlist-to-chart interaction.

### Fidelity Surfaces
- Typography: compact Tahoma/Arial, 11 px numeric grid, 18 px stable rows, tabular figures, single-line symbols and zero letter spacing. The source is a compressed native-terminal screenshot; the implementation does not reproduce compression artifacts or unreadable tiny glyphs.
- Layout: black unframed grid, flat gray header and controls, bottom watchlist tabs, no rounded cards. Full watchlist scroll area is 591 px at 1492 x 728; opening Chart reduces it to about 281 px and adds a 310 px lower chart panel. Closing returns it to 591 px.
- Color: neutral gray chrome, black watch and plot, pale text, outlined selected row, blue uptick/red downtick cells based only on fresh changed values. Flashing is suppressed under reduced-motion preferences. No first-load, stale-quote or unchanged-value flashing.
- Assets: Lucide controls and a genuine Lightweight Charts candlestick/volume canvas; no rasterized UI or decorative imagery. Required TradingView attribution retained. Final chart screenshot contains 9,246 green and 8,012 red pixels in the sampled plot region, confirming nonblank candles alongside visual inspection.
- Content: broker OHLC is preserved by the history endpoint; volume remains lots in the chart, while explicitly named terminal quantity/volume/OI columns convert lots back to units using contract lot size. Missing values show `--`, never fabricated prices.

### Verification and Limits
- 77 frontend tests across 10 suites passed, including full-screen toggle, lazy chart fetching, close/restore, selection, preserving depth preferences, options filtering, quantity conversion, fresh-quote flashes, timeout cleanup, keyboard selection, sorting, and actual OHLC series rendering.
- 32 focused backend Equity/Index Options tests passed. Local optimized preview build and `git diff --check` passed. Existing Browserslist age warning remains.
- Browser-tested desktop/mobile open/close, chart range and contract change, Next/Far futures, stock/expiry/strike/CE selection, market depth collapse, horizontal scrolling with sticky symbols, and responsive controls at 320/390/1492 px. Browser warning/error logs were empty.
- Browser verification used clearly labeled sample data; live broker quotes/history were not revalidated. Four-second quote polling remains the existing feed behavior, not an exchange tick stream. No new order actions exist.
- Frozen preview values intentionally do not reproduce the reference's flashing colors; fresh-value transitions are covered by focused tests. Full proprietary indicator panels and floating index values are outside this interaction change.
- FYERS tracked-diff checksum and all untracked FYERS file checksums match their pre-task values. No commit, push, or production deployment was made.

### Checklist
- [x] Full-screen watchlist with optional chart below.
- [x] Close chart restores full list height; exit restores regular frontend.
- [x] Desktop and responsive phone verification, source comparison and tests complete.
- [x] Local server left running on port 8008.
- [ ] Live broker-session verification before production rollout.
- [ ] User approval before pushing; FYERS stays local.

final result: passed
