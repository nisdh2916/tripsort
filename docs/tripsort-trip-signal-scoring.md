# TripSort Trip Signal Scoring

TripSort should not ask the VLM to directly decide final trip groups. The safer design is:

```text
VLM extracts structured signals
  -> deterministic scoring compares adjacent photos
  -> preview shows the resulting trip folders
  -> user can rename, merge, or split before export
```

This keeps the system explainable and testable. VLM output becomes one input, not the final authority.

## Trip Signals

`/infer-place` now asks `llama3.2-vision` for these fields:

```json
{
  "place": "N Seoul Tower",
  "city": "Seoul",
  "country": "South Korea",
  "landmark": "N Seoul Tower",
  "sceneType": "city skyline",
  "confidence": "medium",
  "reason": "Visible tower and city skyline."
}
```

The frontend stores the travel grouping subset under:

```json
{
  "organization": {
    "tripSignals": {
      "city": "Seoul",
      "country": "South Korea",
      "landmark": "N Seoul Tower",
      "sceneType": "city skyline",
      "confidence": "medium",
      "reason": "Visible tower and city skyline.",
      "source": "vlm"
    }
  }
}
```

Only `high` and `medium` confidence signals affect automatic trip splitting.

## Scoring

TripSort compares adjacent photos inside the same import `tripId`, ordered by known capture date.

Current split score:

| Signal | Score |
| --- | ---: |
| Known capture date gap greater than 3 days | +4 |
| Accepted country signal changes | +5 |
| Accepted city signal changes, with same/unknown country | +3 |
| Accepted city and country are both the same | -4 |

Threshold:

```text
score >= 4 -> start a new trip segment
```

Examples:

```text
2026-05-01 Seoul, South Korea
2026-05-02 Tokyo, Japan
```

Country changed, so the score is `+5`. TripSort splits even though the date gap is only 1 day.

```text
2026-05-01 Seoul, South Korea
2026-05-08 Seoul, South Korea
```

Date gap score is `+4`, but same city/country subtracts `-4`. TripSort keeps them together.

```text
2026-05-01 Jeju
2026-05-10 Tokyo
```

No accepted trip signals exist, so TripSort uses the date-gap fallback and splits.

## Boundaries

VLM still does not infer capture dates or final trip periods. It only supplies structured place/context signals. The deterministic scoring layer decides whether a boundary is strong enough to split.

## Manual Overrides

Automatic scoring is intentionally reviewable. When the user merges or splits trips in the preview, TripSort stores a manual group key:

```json
{
  "organization": {
    "tripGroupId": "manual-trip-..."
  }
}
```

`tripGroupId` overrides automatic scoring during preview and ZIP export.

- Photos with the same `tripGroupId` stay in one trip even if date/signal scoring would split them.
- Photos with different `tripGroupId` values stay in different trips even if scoring would keep them together.
- Trip folder rename still uses `tripName` and applies to the current trip group.

This keeps VLM/scoring useful for the first pass while giving the user final control before export.
