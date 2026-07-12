# Modular Usage Limits Contract

Shared across basebuild-dotnet (website) and basebuild-app (desktop).

## Problem
Plan caps are stored as fixed columns (`sessionRequestCap`, `weeklyRequestCap`, etc.) — hardcoded to 5h sessions. Providers use 4h, 2h, 1h, or other windows. Need modular storage where window length is data.

## ProviderPlanUsageLimit table (new)
```
id          TEXT PRIMARY KEY
planId      TEXT NOT NULL (FK → ProviderPlan.id, CASCADE)
windowSeconds INTEGER     -- 18000=5h, 14400=4h, 7200=2h, 3600=1h, 86400=1d, 604800=7d, 2592000=30d; NULL=per-request
requestCap  INTEGER       -- max requests in window; NULL=no request cap
inputTokenCap  INTEGER    -- max input tokens in window; NULL=no token cap
outputTokenCap INTEGER    -- max output tokens in window; NULL=no token cap
source      TEXT           -- 'scraped' | 'backfill' | 'manual'
confidence  TEXT           -- 'documented' | 'inferred' | 'unknown'
fetchedAt   TEXT
createdAt   TEXT
updatedAt   TEXT
UNIQUE(planId, windowSeconds)
```

## list_plans MCP response — new `usageLimits` array per plan
```json
{
  "id": "...",
  "provider": "umans-ai",
  "name": "Code Pro",
  "price": 17,
  "usageLimits": [
    {"windowSeconds": 18000, "requestCap": 200, "inputTokenCap": null, "outputTokenCap": null, "source": "scraped", "confidence": "documented"},
    {"windowSeconds": 604800, "requestCap": null, "inputTokenCap": 50000000, "outputTokenCap": null, "source": "scraped", "confidence": "documented"}
  ]
}
```
- Flat cap fields (`sessionRequestCap`, `weeklyRequestCap`, etc.) remain for backward compat but are deprecated.
- `usageLimits` is the canonical source going forward.

## AppMessageUsage table (new)
Per-message rows persisted from `sync_messages` so the website can compute usage distribution over arbitrary windows.
```
id          TEXT PRIMARY KEY (the app's message id, dedup)
userId      TEXT NOT NULL (FK → User.id)
provider    TEXT
model       TEXT
ts          INTEGER    -- epoch ms
inputTokens  INTEGER
outputTokens INTEGER
cacheReadTokens INTEGER
costTotal   REAL
durationMs  INTEGER
ttftMs      INTEGER
effort      TEXT
subscriptionTier TEXT
subscriptionSource TEXT
planName    TEXT
outcome     TEXT
syncedAt    TEXT
UNIQUE(userId, id)
INDEX(userId, provider, ts)
```

## get_my_usage_distribution MCP tool (new)
Request: `{"windows": [18000, 604800, 2592000]}` (seconds)
Response:
```json
{
  "providers": {
    "umans-ai": {
      "windows": {
        "18000": {"peakRequests": 150, "peakInputTokens": 450000, "peakOutputTokens": 120000, "peakTotalTokens": 570000},
        "604800": {"peakRequests": 2000, "peakInputTokens": 6000000, "peakOutputTokens": 1500000, "peakTotalTokens": 7500000}
      }
    }
  }
}
```
Computes peak requests/tokens in any fixed bucket of `windowSeconds` from `AppMessageUsage`. Fixed buckets are a conservative proxy for rolling peaks (bucket peak ≤ rolling peak), so "observed > cap" is always sound.

## App-side UsageLimit struct (Rust)
```rust
struct UsageLimit {
    window_seconds: Option<i64>,  // None = per-request
    request_cap: Option<i64>,
    input_token_cap: Option<i64>,
    output_token_cap: Option<i64>,
    confidence: Option<String>,
}
```

## Inference rule (unchanged from current, generalized)
For each plan, for each `UsageLimit` with a defined `windowSeconds` + `requestCap`/`inputTokenCap`:
1. Compute observed peak in that window from stats.db (app) or AppMessageUsage (website).
2. If observed > cap → plan is ruled out for that window.
3. Pick cheapest plan NOT ruled out. If all ruled out → priciest.
4. If cheapest is NOT ruled out → ambiguous → no guess (no false positive).
5. Result: `confidence: "inferred"`, `source: "volume"`, `needs_declaration: true`.
