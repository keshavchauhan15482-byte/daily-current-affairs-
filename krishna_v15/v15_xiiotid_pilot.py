import os, json, math, random, hashlib, glob, sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import confusion_matrix, precision_score, recall_score, f1_score, average_precision_score, brier_score_loss

SEEDS = [42, 43, 44]
HISTORY = 8
HORIZON = 4
MIN_RECALL = 0.80
MAX_TRAIN = 80000
OUT = Path("artifacts/v15")
OUT.mkdir(parents=True, exist_ok=True)


def norm(s):
    return ''.join(ch.lower() for ch in str(s) if ch.isalnum())


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def pick_col(cols, names):
    m = {norm(c): c for c in cols}
    for n in names:
        if norm(n) in m:
            return m[norm(n)]
    return None


def parse_time(df):
    date_col = pick_col(df.columns, ['Date'])
    ts_col = pick_col(df.columns, ['Timestamp', 'Ts', 'Time'])
    if ts_col is None:
        raise RuntimeError('No timestamp column found; refusing temporal forecast experiment')
    if date_col and date_col != ts_col:
        s = df[date_col].astype(str).str.strip() + ' ' + df[ts_col].astype(str).str.strip()
        dt = pd.to_datetime(s, errors='coerce', utc=True, infer_datetime_format=True)
        if dt.notna().mean() >= 0.80:
            return dt, date_col, ts_col
    s = df[ts_col]
    dt = pd.to_datetime(s.astype(str), errors='coerce', utc=True, infer_datetime_format=True)
    if dt.notna().mean() >= 0.80:
        return dt, date_col, ts_col
    num = pd.to_numeric(s, errors='coerce')
    if num.notna().mean() >= 0.80:
        med = float(num.dropna().median())
        unit = 'ms' if med > 1e11 else 's'
        dt = pd.to_datetime(num, unit=unit, errors='coerce', utc=True)
        if dt.notna().mean() >= 0.80:
            return dt, date_col, ts_col
    raise RuntimeError('Timestamp parsing support below 80%; refusing temporal labels')


def detect_label(df):
    candidates = [c for c in df.columns if any(k in norm(c) for k in ['class', 'label'])]
    reports = []
    for c in candidates:
        vals = df[c].dropna().astype(str).str.strip()
        uniq = vals.value_counts().head(30)
        low = {str(v).lower() for v in uniq.index}
        reports.append((c, len(low), list(uniq.index[:10])))
        if any(v in low for v in ['normal', 'benign', '0']):
            # Prefer a binary normal-v-attack column if available.
            if len(low) <= 5:
                y = ~vals.str.lower().isin(['normal', 'benign', '0', 'false'])
                out = pd.Series(np.nan, index=df.index, dtype='float64')
                out.loc[vals.index] = y.astype(float)
                return out, c, reports
    # Fallback to any binary numeric label column.
    for c in candidates:
        x = pd.to_numeric(df[c], errors='coerce')
        u = set(x.dropna().unique().tolist())
        if u and u.issubset({0, 1, 0.0, 1.0}):
            return x.astype(float), c, reports
    raise RuntimeError(f'No trustworthy binary attack label found. Candidates={reports}')


def choose_numeric_features(df, excluded):
    leak_words = ['label', 'class', 'attack', 'alert', 'rule', 'ossec', 'anomaly', 'uid', 'date', 'timestamp', 'time', 'srcip', 'scri', 'desip', 'dstip']
    chosen = []
    sample = df.head(min(len(df), 50000))
    for c in df.columns:
        nc = norm(c)
        if c in excluded or any(w in nc for w in leak_words):
            continue
        sx = sample[c].replace(['-', '?', 'None', 'none', 'null', ''], np.nan)
        num = pd.to_numeric(sx, errors='coerce')
        if num.notna().mean() < 0.85:
            continue
        if num.nunique(dropna=True) <= 1:
            continue
        chosen.append(c)
    # Limit to a stable, compute-bounded feature set by data completeness and variance.
    scored = []
    for c in chosen:
        x = pd.to_numeric(sample[c].replace(['-', '?', ''], np.nan), errors='coerce')
        scored.append((float(x.notna().mean()), float(np.nanvar(x.to_numpy(dtype=float))), c))
    scored.sort(key=lambda z: (z[0], math.log1p(z[1]) if np.isfinite(z[1]) else -1), reverse=True)
    return [c for _, _, c in scored[:24]]


def build_minute_state(df, dt, y, label_col, date_col, ts_col):
    src_col = pick_col(df.columns, ['Scr_IP', 'Src_IP', 'Source_IP', 'source_ip'])
    dst_col = pick_col(df.columns, ['Des_IP', 'Dst_IP', 'Destination_IP', 'dst_ip'])
    excluded = {x for x in [label_col, date_col, ts_col, src_col, dst_col] if x}
    excluded.update(c for c in df.columns if any(k in norm(c) for k in ['class', 'label']))
    feature_cols = choose_numeric_features(df, excluded)
    if len(feature_cols) < 4:
        raise RuntimeError(f'Only {len(feature_cols)} non-leaking numeric features found; refusing fit')

    base = pd.DataFrame({'dt': dt, 'y': y})
    base['src'] = df[src_col].astype(str) if src_col else 'GLOBAL'
    if dst_col:
        base['dst'] = df[dst_col].astype(str)
    for c in feature_cols:
        base[c] = pd.to_numeric(df[c].replace(['-', '?', ''], np.nan), errors='coerce')
    base = base.dropna(subset=['dt', 'y']).copy()
    base['minute'] = base['dt'].dt.floor('min')
    base['y'] = base['y'].astype(int)

    # Median-fill numeric telemetry globally; labels/timestamps are never imputed.
    for c in feature_cols:
        med = base[c].median()
        base[c] = base[c].fillna(0.0 if pd.isna(med) else med)

    agg = {c: ['mean', 'std', 'max'] for c in feature_cols}
    g = base.groupby(['src', 'minute'], sort=True)
    state = g.agg(agg)
    state.columns = ['__'.join(x) for x in state.columns]
    state['flow_count'] = g.size().astype(float)
    state['attack_now'] = g['y'].max().astype(int)
    if dst_col:
        state['unique_dst'] = g['dst'].nunique().astype(float)
    state = state.reset_index().sort_values(['src', 'minute'])
    fcols = [c for c in state.columns if c not in ['src', 'minute', 'attack_now']]
    return state, fcols, feature_cols, src_col, dst_col


def sequences(state, fcols):
    X, Y, cutoff, clean = [], [], [], []
    for src, g in state.groupby('src', sort=False):
        g = g.sort_values('minute').reset_index(drop=True)
        t = g['minute'].astype('int64').to_numpy() // 10**9
        a = g['attack_now'].to_numpy(dtype=int)
        z = g[fcols].to_numpy(dtype=np.float32)
        n = len(g)
        for i in range(HISTORY - 1, n - HORIZON):
            idx0 = i - HISTORY + 1
            # Require observed contiguous minute history and future. No padding across gaps.
            span = t[idx0:i + HORIZON + 1]
            if len(span) != HISTORY + HORIZON:
                continue
            if not np.all(np.diff(span) == 60):
                continue
            X.append(z[idx0:i + 1])
            Y.append(int(a[i + 1:i + HORIZON + 1].max()))
            cutoff.append(int(t[i]))
            clean.append(bool(a[idx0:i + 1].max() == 0))
    if not X:
        raise RuntimeError('No contiguous 8-minute histories with 4-minute future coverage')
    return np.stack(X), np.asarray(Y, dtype=int), np.asarray(cutoff, dtype=np.int64), np.asarray(clean, dtype=bool)


def chronological_split(cutoff, y):
    order = np.argsort(cutoff, kind='stable')
    n = len(order)
    if n < 200:
        raise RuntimeError(f'Only {n} sequences; insufficient for four-way evidence split')
    cuts = [0, int(.60*n), int(.75*n), int(.85*n), n]
    names = ['train', 'calibration', 'policy', 'test']
    out = {}
    for j, name in enumerate(names):
        idx = order[cuts[j]:cuts[j+1]]
        # Embargo first HISTORY+HORIZON examples of each later partition.
        if j > 0 and len(idx) > HISTORY + HORIZON:
            idx = idx[HISTORY + HORIZON:]
        out[name] = idx
    for name, idx in out.items():
        c = np.bincount(y[idx], minlength=2)
        if c.min() < 10:
            raise RuntimeError(f'{name} class support insufficient after chronological split: benign={c[0]}, attack={c[1]}')
    return out


def sample_train(idx, y, seed):
    if len(idx) <= MAX_TRAIN:
        return idx
    rng = np.random.default_rng(seed)
    pos = idx[y[idx] == 1]
    neg = idx[y[idx] == 0]
    npick = min(len(pos), MAX_TRAIN // 2)
    nnick = min(len(neg), MAX_TRAIN - npick)
    if npick + nnick < MAX_TRAIN:
        rem = MAX_TRAIN - npick - nnick
        pool = np.setdiff1d(idx, np.concatenate([rng.choice(pos, npick, replace=False), rng.choice(neg, nnick, replace=False)]), assume_unique=False)
        extra = rng.choice(pool, min(rem, len(pool)), replace=False) if len(pool) else np.array([], dtype=int)
    else:
        extra = np.array([], dtype=int)
    sel = np.concatenate([
        rng.choice(pos, npick, replace=False),
        rng.choice(neg, nnick, replace=False),
        extra
    ])
    rng.shuffle(sel)
    return sel


def platt_fit(raw, y):
    m = LogisticRegression(C=1e6, solver='lbfgs', max_iter=300)
    m.fit(np.asarray(raw).reshape(-1, 1), y)
    return m


def platt_apply(m, raw):
    return m.predict_proba(np.asarray(raw).reshape(-1, 1))[:, 1]


def choose_threshold(y, p):
    best = None
    for th in np.unique(np.concatenate([np.linspace(0.01, 0.99, 197), p])):
        pred = p >= th
        tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0,1]).ravel()
        rec = tp / (tp + fn) if tp + fn else 0.0
        fpr = fp / (fp + tn) if fp + tn else 1.0
        prec = tp / (tp + fp) if tp + fp else 0.0
        if rec >= MIN_RECALL:
            cand = (fpr, -rec, -prec, float(th))
            if best is None or cand < best:
                best = cand
    return None if best is None else best[3]


def metrics(y, p, th):
    pred = p >= th
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0,1]).ravel()
    return {
        'n': int(len(y)), 'benign': int((y==0).sum()), 'attack': int((y==1).sum()),
        'threshold': float(th), 'tn': int(tn), 'fp': int(fp), 'fn': int(fn), 'tp': int(tp),
        'fpr': float(fp/(fp+tn)) if fp+tn else None,
        'recall': float(tp/(tp+fn)) if tp+fn else None,
        'precision': float(tp/(tp+fp)) if tp+fp else None,
        'f1': float(f1_score(y, pred, zero_division=0)),
        'pr_auc': float(average_precision_score(y, p)),
        'brier': float(brier_score_loss(y, p)),
    }


def fit_logistic(X, y, split, seed):
    tr = sample_train(split['train'], y, seed)
    ca, po, te = split['calibration'], split['policy'], split['test']
    scaler = StandardScaler()
    xf = X.reshape(len(X), -1)
    scaler.fit(xf[tr])
    xtr = scaler.transform(xf[tr])
    model0 = LogisticRegression(max_iter=400, class_weight='balanced', solver='liblinear', random_state=seed)
    model0.fit(xtr, y[tr])
    # Training-only hard negatives: benign training rows the first model scores highly.
    p0 = model0.predict_proba(xtr)[:,1]
    w = np.ones(len(tr), dtype=float)
    w[(y[tr] == 0) & (p0 >= 0.50)] = 3.0
    model = LogisticRegression(max_iter=400, class_weight='balanced', solver='liblinear', random_state=seed)
    model.fit(xtr, y[tr], sample_weight=w)
    raw_cal = model.decision_function(scaler.transform(xf[ca]))
    cal = platt_fit(raw_cal, y[ca])
    ppol = platt_apply(cal, model.decision_function(scaler.transform(xf[po])))
    th = choose_threshold(y[po], ppol)
    actionable = th is not None
    if th is None:
        th = 0.5
    ptest = platt_apply(cal, model.decision_function(scaler.transform(xf[te])))
    return metrics(y[te], ptest, th), actionable, int(((y[tr] == 0) & (p0 >= .5)).sum())


def fit_lstm(X, y, split, seed):
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
    torch.set_num_threads(max(1, min(2, os.cpu_count() or 1)))
    tr = sample_train(split['train'], y, seed)
    ca, po, te = split['calibration'], split['policy'], split['test']
    # Feature scaling fit on training timesteps only.
    sc = StandardScaler()
    sc.fit(X[tr].reshape(-1, X.shape[-1]))
    def sx(ix):
        z = sc.transform(X[ix].reshape(-1, X.shape[-1])).reshape(len(ix), X.shape[1], X.shape[2])
        return z.astype(np.float32)
    xtr = sx(tr)
    ytr = y[tr].astype(np.float32)
    class Net(nn.Module):
        def __init__(self, f):
            super().__init__()
            self.rnn = nn.LSTM(f, 32, batch_first=True)
            self.head = nn.Sequential(nn.Linear(32,16), nn.ReLU(), nn.Linear(16,1))
        def forward(self, x):
            o,_ = self.rnn(x)
            return self.head(o[:,-1,:]).squeeze(1)
    net = Net(X.shape[-1])
    pos = max(1, int((ytr==1).sum())); neg = max(1, int((ytr==0).sum()))
    lossfn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor([neg/pos], dtype=torch.float32))
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    dl = DataLoader(TensorDataset(torch.from_numpy(xtr), torch.from_numpy(ytr)), batch_size=256, shuffle=True)
    net.train()
    for _ in range(12):
        for xb, yb in dl:
            opt.zero_grad(set_to_none=True)
            loss = lossfn(net(xb), yb)
            loss.backward()
            opt.step()
    def logits(ix):
        net.eval(); z=sx(ix); out=[]
        with torch.no_grad():
            for i in range(0,len(z),1024):
                out.append(net(torch.from_numpy(z[i:i+1024])).numpy())
        return np.concatenate(out)
    raw_cal = logits(ca)
    cal = platt_fit(raw_cal, y[ca])
    ppol = platt_apply(cal, logits(po))
    th = choose_threshold(y[po], ppol)
    actionable = th is not None
    if th is None:
        th = 0.5
    ptest = platt_apply(cal, logits(te))
    return metrics(y[te], ptest, th), actionable


def main():
    import kagglehub
    dataset = 'munaalhawawreh/xiiotid-iiot-intrusion-dataset'
    root = Path(kagglehub.dataset_download(dataset))
    csvs = list(root.rglob('*.csv'))
    if not csvs:
        raise RuntimeError(f'No CSV found under KaggleHub dataset {root}')
    csv_path = max(csvs, key=lambda p: p.stat().st_size)
    provenance = {
        'dataset': 'X-IIoTID',
        'official_repo': 'https://github.com/Alhawawreh/X-IIoTID',
        'transport_mirror': 'https://www.kaggle.com/datasets/munaalhawawreh/xiiotid-iiot-intrusion-dataset',
        'local_filename': csv_path.name,
        'bytes': csv_path.stat().st_size,
        'sha256': sha256(csv_path),
    }
    print('Loading', csv_path, provenance['bytes'])
    df = pd.read_csv(csv_path, low_memory=False)
    provenance['rows'] = int(len(df)); provenance['columns'] = int(len(df.columns))
    dt, date_col, ts_col = parse_time(df)
    y, label_col, label_reports = detect_label(df)
    state, fcols, raw_features, src_col, dst_col = build_minute_state(df, dt, y, label_col, date_col, ts_col)
    X, target, cutoff, clean = sequences(state, fcols)
    split = chronological_split(cutoff, target)

    report = {
        'schema': 'krishna-v15-xiiotid-temporal-pilot-v1',
        'claim_scope': 'fresh chronological X-IIoTID temporal-risk pilot; not a verified-compromise claim and not the old V13 DoS holdout',
        'provenance': provenance,
        'detected': {'date_col': date_col, 'timestamp_col': ts_col, 'label_col': label_col, 'source_ip_col': src_col, 'destination_ip_col': dst_col, 'raw_numeric_features': raw_features, 'state_feature_count': len(fcols), 'label_candidates': label_reports},
        'sequence': {'history_minutes': HISTORY, 'future_horizon_minutes': HORIZON, 'n': int(len(X)), 'benign_targets': int((target==0).sum()), 'attack_targets': int((target==1).sum()), 'clean_history_n': int(clean.sum())},
        'splits': {k: {'n': int(len(v)), 'benign': int((target[v]==0).sum()), 'attack': int((target[v]==1).sum()), 'first_cutoff_epoch': int(cutoff[v].min()), 'last_cutoff_epoch': int(cutoff[v].max())} for k,v in split.items()},
        'seeds': {},
    }
    for seed in SEEDS:
        print('seed', seed, 'logistic')
        lm, la, hn = fit_logistic(X, target, split, seed)
        print('seed', seed, 'lstm')
        tm, ta = fit_lstm(X, target, split, seed)
        report['seeds'][str(seed)] = {'history_logistic': lm, 'history_logistic_actionable': la, 'hard_negatives_upweighted': hn, 'lstm': tm, 'lstm_actionable': ta}
        print(seed, 'logistic', lm)
        print(seed, 'lstm', tm)

    def avg(model, key):
        vals = [report['seeds'][str(s)][model][key] for s in SEEDS]
        vals = [v for v in vals if v is not None]
        return float(np.mean(vals)) if vals else None
    report['three_seed_mean'] = {
        'history_logistic': {k: avg('history_logistic', k) for k in ['fpr','recall','precision','f1','pr_auc','brier']},
        'lstm': {k: avg('lstm', k) for k in ['fpr','recall','precision','f1','pr_auc','brier']},
    }
    report['release_gate'] = {
        'target': 'FPR <= 0.06 and recall >= 0.80 on untouched chronological test',
        'history_logistic_pass': bool(report['three_seed_mean']['history_logistic']['fpr'] is not None and report['three_seed_mean']['history_logistic']['fpr'] <= .06 and report['three_seed_mean']['history_logistic']['recall'] >= .80 and all(report['seeds'][str(s)]['history_logistic_actionable'] for s in SEEDS)),
        'lstm_pass': bool(report['three_seed_mean']['lstm']['fpr'] is not None and report['three_seed_mean']['lstm']['fpr'] <= .06 and report['three_seed_mean']['lstm']['recall'] >= .80 and all(report['seeds'][str(s)]['lstm_actionable'] for s in SEEDS)),
        'note': 'This pilot can validate temporal false-alarm behavior on X-IIoTID, but does not by itself prove pre-compromise warning, campaign-level independence, MITRE future-stage accuracy, or production blocking.'
    }
    with open(OUT/'results.json','w') as f: json.dump(report,f,indent=2)
    md = ['# Krishna Defence V15 — X-IIoTID temporal pilot', '', report['claim_scope'], '', '## Three-seed mean', '', '| Model | FPR | Recall | Precision | F1 | PR-AUC | Brier |', '|---|---:|---:|---:|---:|---:|---:|']
    for model in ['history_logistic','lstm']:
        m=report['three_seed_mean'][model]
        md.append(f"| {model} | {m['fpr']:.4f} | {m['recall']:.4f} | {m['precision']:.4f} | {m['f1']:.4f} | {m['pr_auc']:.4f} | {m['brier']:.4f} |")
    md += ['', '## Gate', '', json.dumps(report['release_gate'], indent=2), '', '## Provenance', '', json.dumps(provenance, indent=2)]
    (OUT/'REPORT.md').write_text('\n'.join(md))
    print(json.dumps(report['three_seed_mean'], indent=2))
    print(json.dumps(report['release_gate'], indent=2))

if __name__ == '__main__':
    main()
