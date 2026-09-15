# Krishna Defence V15 — X-IIoTID GNN+LSTM evidence

## Evidence identity

- GitHub Actions run: `34968239441`
- Job: `104377803183`
- Branch: `krishna-v15`
- Run commit: `11d99b9471040c284351cdb03d9a1e5c9496e8c1`
- Immutable Actions artifact: `krishna-v15-xiiotid-gnn-lstm-evidence`, artifact ID `10396560494`
- Artifact ZIP SHA-256: `66755d282f87bec39976146aaa0a02f59b1c5472d4802fd1e776339a0ac9e4ec`
- Dataset file SHA-256: `7b9290057ee42e784da3c0d84b781815502c9205c74175c96374e71a5ffd98a0`
- Dataset rows / columns: `820,834 / 68`

## Claim scope

This is a one-hop mean-message GraphSAGE-style spatial encoder followed by an LSTM temporal encoder. It uses the same fresh chronological X-IIoTID protocol as the V15 LSTM/logistic pilot: 8-minute observed history, 4-minute future malicious-traffic target, chronological train/calibration/policy/test partitions, 720-second embargo, train-only preprocessing, calibration-only calibration, policy-only threshold selection, and untouched chronological test evaluation. It is not verified-compromise forecasting, campaign-independent validation, supervised MITRE progression validation, or production approval.

## Graph construction

- Source IP field: `Scr_IP`
- Destination IP field: `Des_IP`
- Unique source→destination minute edges: `84,120`
- Self-state feature count: `74`
- Neighbor-message feature count: `28`
- Message passing: mean destination-node state from the same minute only; no future graph rows are used.
- Spatial encoder: trainable self projection + trainable one-hop neighbor projection + LayerNorm/ReLU.
- Temporal encoder: 32-unit LSTM over the 8 graph-enriched minute states.

## Frozen split

| Partition | Total | Benign | Attack |
|---|---:|---:|---:|
| Train | 21,219 | 18,423 | 2,796 |
| Calibration | 3,784 | 3,268 | 516 |
| Policy | 2,700 | 1,922 | 778 |
| Untouched chronological test | 2,521 | 1,366 | 1,155 |

## GNN+LSTM untouched-test results

| Seed | Threshold | FP / benign | FPR | Recall | Precision | F1 | PR-AUC | Brier |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 42 | 0.002627 | 20 / 1,366 | 1.4641% | 81.2121% | 97.9123% | 88.7837% | 0.970672 | 0.236421 |
| 43 | 0.008619 | 1 / 1,366 | 0.0732% | 84.4156% | 99.8975% | 91.5063% | 0.997873 | 0.249026 |
| 44 | 0.000391 | 11 / 1,366 | 0.8053% | 77.4026% | 98.7845% | 86.7961% | 0.984238 | 0.359531 |

Three-seed mean:

- FPR: **0.7809%**
- Recall: **81.0101%**
- Precision: **98.8648%**
- F1: **89.0287%**
- PR-AUC: **0.984261**
- Brier score: **0.281659**

The previously defined mean engineering gate (mean FPR <= 6%, mean recall >= 80%, valid policy threshold in every seed) passes. However, a stricter all-seed recall >= 80% rule would fail because seed 44 recall is 77.40%. Calibration is also materially weaker than the plain LSTM, as indicated by the much larger Brier score and very low policy thresholds.

## Same-test comparison

| Model | Mean FPR | Mean Recall | Precision | F1 | PR-AUC | Brier |
|---|---:|---:|---:|---:|---:|---:|
| History logistic | 0.2196% | 86.5801% | 99.7009% | 92.6784% | 0.994774 | 0.030247 |
| Plain LSTM | 0.0000% observed | 86.0895% | 100.0000% | 92.5147% | 0.991499 | 0.046106 |
| **GraphSAGE + LSTM** | **0.7809%** | **81.0101%** | **98.8648%** | **89.0287%** | **0.984261** | **0.281659** |

On this frozen X-IIoTID test, the current GNN+LSTM does **not** improve over the plain LSTM or logistic readout. It remains useful as an architecture experiment, but the evidence does not justify presenting it as the strongest model.

## Critical evidence limit

The test still contains zero clean-history future-positive examples under this 8-minute-history / 4-minute-horizon definition. Therefore none of these results establish clean-history pre-compromise warning. The next model work should target graph calibration/robustness and, more importantly, an independent timestamped dataset/campaign set with clean-history attack onsets.
