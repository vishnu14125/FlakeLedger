# Phase 3.5: Diagnosis Generalization & Adversarial Validation

## 1. Objective
The objective of Phase 3.5 was to identify and eliminate any "semantic leakage" in the diagnosis engine—specifically, ensuring that the engine classifies test behavior based *exclusively* on mathematical/statistical condition differentials, rather than "guessing" based on string matches in `conditionId` (e.g. `id.includes('concurrency')`).

## 2. Semantic Leakage Audit
**Semantic leakage found:** YES
**Locations:** `src/diagnosis.ts:138-144`
**Impact:** The engine was hardcoding logical branches checking if the most failing `conditionId` string contained `concur`, `order`, or `env`. This caused it to magically output `CONCURRENCY_SENSITIVE` without explicit user metadata.
**Resolution:** Removed string-matching logic completely. Replaced it with a generic metadata lookup `config.conditionDefs[cid].type`. If no metadata is present, it safely outputs the generic `CONDITION_SENSITIVE`.

## 3. Diagnosis Invariance Tests
1. **Opaque Condition IDs:** I tested creating an experiment using opaque condition names (`variant-X` vs `control`) but supplied semantic metadata `type: "concurrency"`. The engine successfully output `CONCURRENCY_SENSITIVE` purely because of the metadata, not the ID.
2. **Renaming Target:** I tested changing the `target` test filename to `totally-different-name.test.ts`. The diagnosis remained exactly the same (`CONDITION_SENSITIVE`).
3. **Reordering Conditions:** I provided the observations in inverted order (`C2` then `C1` instead of `C1` then `C2`). The diagnosis deterministically remained `ORDER_SENSITIVE`.

## 4. Sample-Size Validation
Validated edge boundaries for confidence derivation:
- **1 vs 1 (Total: 2):** Outputs `INSUFFICIENT_EVIDENCE` (Confidence: `INSUFFICIENT`)
- **2 vs 2 (Total: 4):** Outputs `CONDITION_SENSITIVE` (Confidence: `LOW`)
- **3 vs 3 (Total: 6):** Outputs `CONDITION_SENSITIVE` (Confidence: `MEDIUM`)
- **10 vs 10 (Total: 20):** Outputs `CONDITION_SENSITIVE` (Confidence: `HIGH`)

## 5. Effect-Size Validation
Validated threshold limits (delta = maxFailRate - minFailRate):
- **Delta 100% (0% baseline vs 100% variant):** High sensitivity detected (`HIGH` confidence)
- **Delta 65% (0% baseline vs 65% variant):** Sensitivity detected (`MEDIUM` confidence)
- **Delta 10% (10% baseline vs 20% variant):** No sensitivity detected. Falls back to `INTERMITTENT`.

## 6. Small-Sample Ambiguity
Tested 2/3 pass on baseline vs 1/3 pass on variant. Delta is 33% (0.33), which is less than the 0.6 threshold. Since total runs is very small, it correctly classified as `INTERMITTENT` with `LOW` confidence. It successfully remains cautious rather than jumping to false condition sensitivity.

## 7. Fingerprint Validation
Tested a scenario where the delta was 100%, but the failure error hashes were heterogenous (split 50/50 between two distinct errors). 
- It correctly continued to classify as `CONDITION_SENSITIVE` because the failure probability was unequivocally driven by the perturbation. 
- However, the explanation automatically degraded from "highly consistent" to mentioning "Failure fingerprints varied, suggesting multiple failure modes or volatile stack traces."

## 8. Real Benchmark Results
After adding semantic metadata (e.g., `type: "order"`) into `flakeledger.config.json`, the real benchmarks parsed out precisely the same as Phase 3, but this time driven entirely by generic statistical mechanics rather than string matching:
- **Timezone**: `ENVIRONMENT_SENSITIVE`
- **Order**: `ORDER_SENSITIVE`
- **Concurrency**: `CONCURRENCY_SENSITIVE`
- **Intermittent**: `INTERMITTENT`
- **Stable**: `STABLE`

## 9. False Positives / False Negatives
- No false positives were observed in the tested validation cases.
- No false negatives were observed in the tested validation cases.

## 10. Remaining Limitations
- The error hash consistency check is still vulnerable to inherently random stack trace variables (like random UUIDs in test mocks). If a test generates a random ID in its error message every run, the fingerprint engine will falsely assume multiple bug vectors exist, though the core classification will still hold.

## 11. Phase 4 Readiness
**READY FOR PHASE 4**
