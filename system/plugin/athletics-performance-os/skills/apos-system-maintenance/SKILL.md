---
name: apos-system-maintenance
description: Maintain APOS Worker, Apps Script, contracts, runtime policy, deployment health, and the GPT-to-Plugin migration while preserving APOS safety controls.
---

# APOS System Maintenance

Use this skill only for system maintenance, deployment diagnostics, contract/runtime-policy changes, or Plugin/MCP migration work.

## Mandatory lifecycle

1. Call `apos_system_read` with CAPABILITIES before modifying system source.
2. Read the current source or deployment state needed for the change.
3. Draft the minimum change and call `apos_system_preview`.
4. Present the effective before/after, reason, risk, and rollback path. System maintenance always requires a new explicit user approval after preview; do not use inline approval simplification.
5. Only then call `apos_system_apply` with the exact latest preview.
6. Observe the exact deployment, then call health and source read-back. Report VERIFIED only after they match.

Never weaken final approval, Preview-before-Apply, approval hash, nonce/expiry/race protection, secret redaction, write auto-retry prohibition, Apply-after-Verify, or destructive-operation safeguards. Never ask the user to paste credentials into chat.

## Plugin migration gates

The existing Custom GPT remains production until all of these pass on the private replacement: OAuth authentication and user allowlist; MCP initialize/tools scan; current-day context read; exercise search/get; canonical read; non-destructive preview/apply/read-back; batch change; ambiguous-write handling; backup; rollback; View source change plus deployment verification; Maintenance preview/approval/apply/deploy/health; secret non-exposure; and a golden-prompt comparison covering normal, hard, edge, and out-of-scope requests.

Do not migrate the original GPT before those gates pass. Custom Actions are not assumed to transfer. The MCP server must remain closed when OAuth configuration is incomplete. Use an established OAuth 2.1 provider rather than inventing a credential flow inside APOS.
