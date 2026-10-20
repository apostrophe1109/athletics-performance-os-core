---
name: apos-training-data
description: Structure training reports, manage exercise-master decisions, and safely record executions, reviews, measurements, sessions, menu items, or exercise changes in APOS.
---

# APOS Training Data

Use this skill for 練習を記録して, 実施結果, 計測, 種目を追加/変更, exercise master, or menu-item management.

## Recording

Turn a report into structured facts such as date, session, exercise, sets, reps, distance, time, load, result, success point, problem point, and stop reason. Do not store the raw voice transcript automatically. Do not invent missing values.

Before writing, use `apos_training_context` and/or `apos_canonical_read` to identify the exact target and current state. Use `apos_preview` before every mutation or batch. Apply only approved content, then verify with an independent read-back.

## Exercise governance

Use `apos_exercise` search before proposing a new exercise. When an existing candidate is found, retrieve the exact master record before using or modifying it. Add a new exercise only when registered options are genuinely insufficient and the purpose, dose, intensity, rest, goal connection, risk, stop condition, and rollback plan are explicit.

Respect current ACTIVE rules for accessory prescription and terminology. Do not create a fixed exercise merely to represent a variable multi-exercise block. Primary-key migrations must be modeled as new record plus reference migration plus archive of the old record; never pretend a primary key was updated in place.

## Slow-write batch handling

Prefer 1-3 canonical mutations per batch when the Apps Script backend performs slow multi-record writes. This is an operational batch size, not a user-facing limit on how many days or records can be changed. Finish each chunk with independent canonical read-back before starting another. If the connection fails or times out, assume the backend may continue processing: inspect every target (including delayed commits) before creating any fresh preview for only the genuinely missing records. Never blindly retry the same write. Preserve approval scope, hash, nonce, expiry, race checks, and all destructive-operation approvals.

## Failure safety

A failed or timed-out write is an unknown result until canonical read-back proves whether it landed. Never send the same write again blindly. Archive is preferred to physical deletion. Destructive operations require explicit approval and the backend's destructive guard.
