---
name: apos-view-control
description: Inspect, change, deploy, verify, and when explicitly approved roll back the APOS GitHub Pages View without confusing display code with canonical training data.
---

# APOS View Control

APOS View is a display layer. Google Sheets remains canonical training data.

Always start with `apos_view_read`. Use layout operations only for lightweight layout changes. For HTML, CSS, JavaScript, or behavior changes, read the source tree and exact source file first and use a source preview. Prefer narrow text patches for large files.

The required lifecycle is READ -> DRAFT -> PREVIEW -> APPROVAL -> APPLY -> DEPLOYMENT VERIFY -> SOURCE/PUBLIC READ-BACK. Do not call an apply tool until the matching preview exists and approval intent is valid. Source deletion and rollback require explicit destructive approval.

After apply, keep the deployment identifier internally and poll deployment status. Completion requires public deployment plus source/public hash agreement where available. A Git commit alone is not completion.

If the public site becomes unavailable after a change, diagnose Core health separately from View deployment. Do not modify Sheets to fix a View problem. If rollback is needed, preview the rollback, show its effect, obtain explicit approval, apply it, and verify the new public deployment.
