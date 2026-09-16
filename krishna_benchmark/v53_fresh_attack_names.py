"""Run the standalone Garuda benchmark on fine-grained X-IIoTID attack names.

These exact attack names are held out together from training, calibration and policy
selection. The base harness remains unchanged; only label-level selection and the
predeclared holdout identities differ.
"""
import numpy as np
import pandas as pd

import v53_fresh_unknown as base

base.HOLDOUT = (
    "reverse shell",
    "mitm",
    "tcp relay",
    "false data injection",
    "rdos",
)


def detect_fine_labels(df):
    candidates = [c for c in df.columns if "class" in base.norm(c) or "label" in base.norm(c)]
    binary_col = None
    profiles = []
    for col in candidates:
        vals = df[col].dropna().astype(str).str.strip().str.lower()
        uniq = sorted(set(vals.unique()))
        profiles.append({"column": col, "unique": len(uniq), "sample": uniq[:40]})
        if len(uniq) <= 5 and ({"normal", "attack"} <= set(uniq) or {"benign", "attack"} <= set(uniq)):
            binary_col = col
    if binary_col is None:
        raise ValueError(f"binary label not found: {profiles}")

    choices = []
    for col in candidates:
        if col == binary_col:
            continue
        vals = df[col].dropna().astype(str).str.strip()
        uniq = {base.canonical(v) for v in vals.unique() if base.canonical(v) not in {"normal", "benign", "attack", ""}}
        if 2 <= len(uniq) <= 40:
            choices.append((len(uniq), col))
    if not choices:
        raise ValueError(f"fine attack label not found: {profiles}")
    # X-IIoTID has a coarse attack-family hierarchy and a finer attack-name hierarchy.
    # The larger non-binary hierarchy is the fine-grained attack-name field.
    choices.sort(key=lambda x: (-x[0], x[1]))
    attack_col = choices[0][1]

    text = df[binary_col].astype(str).str.strip().str.lower()
    y = pd.Series(np.nan, index=df.index, dtype=float)
    y.loc[text.isin(["normal", "benign"])] = 0.0
    y.loc[text.eq("attack")] = 1.0
    attack_name = df[attack_col].astype(str).map(base.canonical)
    return y, attack_name, binary_col, attack_col, profiles


base.detect_labels = detect_fine_labels

if __name__ == "__main__":
    base.main()
