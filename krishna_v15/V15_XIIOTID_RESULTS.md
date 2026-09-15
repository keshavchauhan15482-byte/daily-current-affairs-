# Krishna Defence V15 — X-IIoTID chronological temporal pilot

## Evidence identity

- GitHub Actions run: `34967053579`
- Job: `104373889165`
- Branch: `krishna-v15`
- Run commit: `45d3dcdba1f7d5e49c0ebad71f5cf4491ae8c477`
- Immutable Actions artifact: `krishna-v15-xiiotid-evidence-v2`, artifact ID `10396360115`
- Artifact ZIP SHA-256: `935aa8385060c0c63254b6531ee31a9c209a59833641aba4bd9f237ab6529ef2`
- Workflow completed successfully with `set -euo pipefail`, so model/runtime failures cannot be hidden by the logging pipe.

## Claim scope

This is a fresh chronological X-IIoTID future-malicious-traffic pilot. It predicts whether the next four minutes contain attack-labelled traffic from an eight-minute observed history. It is **not** verified-compromise forecasting, campaign-independent validation, supervised future MITRE-stage validation, or production/automatic-containment approval.

## Dataset provenance

- Dataset: X-IIoTID
- Official project repository: `https://github.com/Alhawawreh/X-IIoTID`
- Author download pointer: `https://cloudstor.aarnet.edu.au/plus/s/uCa6M7IDI1S8VrE`
- Transport mirror used by the hosted runner: `munaalhawawreh/xiiotid-iiot-intrusion-dataset`
- File: `X-IIoTID dataset.csv`
- File bytes: `355,308,902`
- File SHA-256: `7b9290057ee42e784da3c0d84b781815502c9205c74175c96374e71a5ffd98a0`
- Rows: `820,834`
- Columns: `68`

## Temporal protocol

- Observed history: 8 minutes
- Future target horizon: 4 minutes
- Total eligible sequences: 30,297
- Benign targets: 25,040
- Attack targets: 5,257
- Split method: chronological cutoff-time partitions with a 720-second embargo between development partitions
- Imputation and scaling: fit on training data only
- Calibration: calibration partition only
- Operating threshold: policy partition only
- Final test: untouched until evaluation
- Fixed seeds: 42, 43, 44; no best-seed promotion

| Partition | Total | Benign | Attack |
|---|---:|---:|---:|
| Train | 21,219 | 18,423 | 2,796 |
| Calibration | 3,784 | 3,268 | 516 |
| Policy | 2,700 | 1,922 | 778 |
| Untouched chronological test | 2,521 | 1,366 | 1,155 |

Training-only hard-negative mining upweighted 187 benign examples for the logistic readout. Derived aggregate telemetry contained non-finite values (primarily singleton-group standard deviations); these were imputed using training-only medians. Labels and timestamps were not imputed.

## Untouched-test results

### History logistic readout

All three fixed seeds produced the same deterministic result at the policy-selected threshold `0.71`:

- TN: 1,363
- FP: 3
- FN: 155
- TP: 1,000
- FPR: **0.2196%**
- Recall: **86.5801%**
- Precision: **99.7009%**
- F1: **92.6784%**
- PR-AUC: **0.994774**
- Brier score: **0.030247**

### LSTM temporal model

| Seed | Threshold | FP / benign | FPR | Recall | Precision | F1 | PR-AUC |
|---|---:|---:|---:|---:|---:|---:|---:|
| 42 | 0.845000 | 0 / 1,366 | 0.0000% | 86.0606% | 100.0000% | 92.5081% | 0.990028 |
| 43 | 0.510000 | 0 / 1,366 | 0.0000% | 83.8961% | 100.0000% | 91.2429% | 0.985482 |
| 44 | 0.869392 | 0 / 1,366 | 0.0000% | 88.3117% | 100.0000% | 93.7931% | 0.998988 |

Three-seed mean:

- Observed FPR: **0.0000%**
- Recall: **86.0895%**
- Precision: **100.0000%**
- F1: **92.5147%**
- PR-AUC: **0.991499**
- Brier score: **0.046106**

The engineering gate used for this pilot was mean FPR <= 6% with recall >= 80% and a valid policy-selected threshold in every seed. Both the history logistic and LSTM variants pass this pilot gate.

## Critical evidence limit

The untouched test contains **zero clean-history future-positive examples** under this eight-minute-history/four-minute-horizon definition. Therefore this experiment does **not** demonstrate a warning before a clean-history attack onset or verified compromise. A zero observed LSTM FPR is also not a claim that the population FPR is literally zero. The next evidence priority is an independent timestamped dataset/campaign set containing enough clean-history positive onsets, followed by a frozen cross-dataset or campaign-level final test.

The historical V12 reused-DoS result (85.42% FPR / 92.86% recall for LSTM-assisted features) is a different dataset and evaluation population and must not be described as a direct 85.42% -> 0% improvement.
