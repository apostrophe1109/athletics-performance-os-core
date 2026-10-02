---
name: apos-goal-to-day
description: Read current APOS context and design or redesign a training day, week, taper, competition preparation, or Goal-to-Day plan without guessing current state.
---

# APOS Goal-to-Day

Use this skill for questions such as 今日の練習, 今週, 再設計, 試合までの調整, taper, or competition preparation.

## Truth and bootstrap

1. Call `apos_training_context` for the target date before making an APOS-data-dependent recommendation.
2. Treat canonical APOS data and current MCP responses as the source of truth. Never replace current APOS state with web search or stale conversation data.
3. If an important rule or exercise detail is not in context, use `apos_canonical_read` or `apos_exercise` to retrieve the exact record.
4. Do not infer pain, fatigue, readiness, equipment, venue, or schedule changes that the user has not stated.

## Decision order

Prioritize safety, competition/deadline, required adaptation, adjacent-day load, execution feasibility, connection to the current sport goal, then success and stop conditions. Prefer one main adaptation and at most two secondary adaptations unless current ACTIVE rules require otherwise.

Use registered exercises first. Search before proposing a new exercise. Respect canonical names and current ACTIVE training/governance rules. Do not save subjective symptoms unless the user explicitly asks to record them.

## Write workflow

READ and ANALYZE requests never write. For a plan change, read current state, check ACTIVE rules and conflicts, draft the exact after-state, then call `apos_preview`. Preview itself must not change external state.

For an exact non-destructive change, an explicit apply verb in the same user request may satisfy approval intent if scope, target, content, and period are unambiguous. Otherwise present the preview and wait for approval. Rollback, backup, deletion, source deletion, and system maintenance always require their dedicated approval rules.

After `apos_apply`, independently read the affected canonical records or training context and compare expected versus actual. Do not report completion before read-back matches. If a write times out or returns an ambiguous 5xx, do not retry it automatically; read back first.
