from __future__ import annotations

import argparse, hashlib, json, math, os, random
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, f1_score
from sklearn.preprocessing import StandardScaler

HISTORY = 8
HORIZON = 4
EMBARGO_STEPS = HISTORY + HORIZON
SEEDS = (42, 43, 44)
FPR_BUDGET = 0.01
POLICY_BUDGET = 0.0025
HOLDOUT = ("ransomware", "rdos")
NETWORK_NUMERIC_NORMALIZED = {
    "scrport", "desport", "duration", "scrbytes", "desbytes", "missedbytes",
    "scrpkts", "despkts", "stripbytes", "desipbytes", "totalbytes",
    "byterate", "totalpacket", "totalpackets", "totalpkts", "packetrate",
    "paketrate", "scrpktsratio", "scrpacksratio", "despktsratio",
    "scrbytesratio", "desbytesratio", "avgrtt", "issynonly", "issynack",
    "ispureack", "iswithpayload", "finorrst", "issynwithrst", "badchecksum",
}


def norm(v):
    return "".join(ch.lower() for ch in str(v) if ch.isalnum())


def canonical(v):
    return " ".join(str(v).replace("_", " ").strip().casefold().split())


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def pick_col(columns, names):
    m = {norm(c): c for c in columns}
    for n in names:
        if norm(n) in m:
            return m[norm(n)]
    return None


def parse_time(df):
    date_col = pick_col(df.columns, ["Date"])
    ts_col = pick_col(df.columns, ["Timestamp", "Ts", "Time"])
    if ts_col is None:
        raise ValueError("timestamp column missing")
    attempts = []
    if date_col and date_col != ts_col:
        attempts.append(("date+timestamp", df[date_col].astype(str).str.strip() + " " + df[ts_col].astype(str).str.strip()))
    attempts.append(("timestamp", df[ts_col]))
    for method, s in attempts:
        dt = pd.to_datetime(s.astype(str), errors="coerce", utc=True)
        if float(dt.notna().mean()) >= 0.80:
            return dt, method
        numeric = pd.to_numeric(s, errors="coerce")
        if float(numeric.notna().mean()) >= 0.80:
            med = float(numeric.dropna().median())
            unit = "ms" if med > 1e11 else "s"
            dt = pd.to_datetime(numeric, unit=unit, errors="coerce", utc=True)
            if float(dt.notna().mean()) >= 0.80:
                return dt, method + ":" + unit
    raise ValueError("could not parse >=80% timestamps")


def detect_labels(df):
    candidates = [c for c in df.columns if "class" in norm(c) or "label" in norm(c)]
    binary_col = None
    profiles = []
    for col in candidates:
        vals = df[col].dropna().astype(str).str.strip().str.lower()
        uniq = sorted(set(vals.unique()))
        profiles.append({"column": col, "unique": len(uniq), "sample": uniq[:30]})
        if len(uniq) <= 5 and ({"normal", "attack"} <= set(uniq) or {"benign", "attack"} <= set(uniq)):
            binary_col = col
    if binary_col is None:
        raise ValueError(f"binary label not found: {profiles}")
    family_choices = []
    for col in candidates:
        if col == binary_col:
            continue
        vals = df[col].dropna().astype(str).str.strip()
        uniq = {v.lower() for v in vals.unique() if v and v.lower() not in {"normal", "benign", "attack"}}
        if 2 <= len(uniq) <= 40:
            family_choices.append((len(uniq), col))
    family_choices.sort(key=lambda x: (x[0], x[1]))
    if not family_choices:
        raise ValueError(f"family label not found: {profiles}")
    family_col = family_choices[0][1]
    text = df[binary_col].astype(str).str.strip().str.lower()
    y = pd.Series(np.nan, index=df.index, dtype=float)
    y.loc[text.isin(["normal", "benign"])] = 0.0
    y.loc[text.eq("attack")] = 1.0
    family = df[family_col].astype(str).map(canonical)
    return y, family, binary_col, family_col, profiles


def choose_features(df):
    selected = []
    for col in df.columns:
        if norm(col) not in NETWORK_NUMERIC_NORMALIZED:
            continue
        s = pd.to_numeric(df[col].head(min(len(df), 100000)).replace(["-", "?", "None", "none", "null", ""], np.nan), errors="coerce")
        if float(s.notna().mean()) >= 0.50 and int(s.nunique(dropna=True)) > 1:
            selected.append(col)
    if len(selected) < 8:
        raise ValueError(f"only {len(selected)} usable network-only features: {selected}")
    return selected


def _family_tuple(values, attacks):
    return tuple(sorted({canonical(v) for v, a in zip(values, attacks) if int(a) == 1 and canonical(v) not in {"normal", "benign", "attack", "nan", "none", ""}}))


def build_state(df, dt, y, family, feature_cols):
    src_col = pick_col(df.columns, ["Scr_IP", "Src_IP", "Source_IP", "source_ip"])
    base = pd.DataFrame({"dt": dt, "binary": y, "family": family})
    base["src"] = df[src_col].astype(str) if src_col else "GLOBAL"
    for c in feature_cols:
        base[c] = pd.to_numeric(df[c].replace(["-", "?", "None", "none", "null", ""], np.nan), errors="coerce")
    base = base.dropna(subset=["dt", "binary"]).copy()
    base["binary"] = base["binary"].astype(int)
    base["minute"] = base["dt"].dt.floor("min")
    grouped = base.groupby(["src", "minute"], sort=True)
    state = grouped[feature_cols].agg(["mean", "std", "max"])
    state.columns = ["__".join(x) for x in state.columns]
    state["flow_count"] = grouped.size().astype(float)
    state["attack_now"] = grouped["binary"].max().astype(int)
    fam = grouped.apply(lambda g: _family_tuple(g["family"].tolist(), g["binary"].tolist()), include_groups=False)
    fam.name = "families"
    state = state.join(fam).reset_index().sort_values(["src", "minute"]).reset_index(drop=True)
    fcols = [c for c in state.columns if c not in {"src", "minute", "attack_now", "families"}]
    return state, fcols, src_col


def make_sequences(state, feature_cols):
    X=[]; F=[]; Y=[]; cut=[]; clean=[]; hf=[]; sf=[]; srcs=[]
    for src, group in state.groupby("src", sort=False):
        g = group.sort_values("minute").reset_index(drop=True)
        t = g["minute"].astype("int64").to_numpy() // 10**9
        a = g["attack_now"].to_numpy(dtype=int)
        z = g[feature_cols].to_numpy(dtype=np.float32)
        fam = g["families"].tolist()
        for i in range(HISTORY-1, len(g)-HORIZON):
            lo=i-HISTORY+1; stop=i+HORIZON+1
            span=t[lo:stop]
            if len(span) != HISTORY+HORIZON or not np.all(np.diff(span)==60):
                continue
            X.append(z[lo:i+1]); F.append(z[i+1:stop]); Y.append(int(a[i+1:stop].max())); cut.append(int(t[i])); srcs.append(str(src))
            clean.append(bool(a[lo:i+1].max()==0))
            hs=set()
            for item in fam[lo:i+1]: hs.update(item)
            hf.append(frozenset(hs)); sf.append(tuple(frozenset(x) for x in fam[i+1:stop]))
    if not X: raise ValueError("no contiguous sequences")
    return {"X":np.stack(X),"future":np.stack(F),"y":np.asarray(Y,dtype=np.int8),"cutoff":np.asarray(cut,dtype=np.int64),"clean":np.asarray(clean,dtype=bool),"history_families":np.asarray(hf,dtype=object),"step_families":np.asarray(sf,dtype=object),"src":np.asarray(srcs,dtype=object)}


def temporal_masks(cutoff):
    times=np.unique(cutoff)
    if len(times)<40: raise ValueError("insufficient unique time cutoffs")
    b1=times[int(.60*(len(times)-1))]; b2=times[int(.75*(len(times)-1))]; b3=times[int(.85*(len(times)-1))]; emb=(HISTORY+HORIZON)*60
    return {"train":cutoff<=b1,"calibration":(cutoff>b1+emb)&(cutoff<=b2),"policy":(cutoff>b2+emb)&(cutoff<=b3),"test":cutoff>b3+emb},{"b1":int(b1),"b2":int(b2),"b3":int(b3),"embargo_seconds":int(emb)}


def touches_holdout(seq, holdout):
    h=set(holdout)
    return np.asarray([bool(h.intersection(hist)) or any(bool(h.intersection(step)) for step in steps) for hist,steps in zip(seq["history_families"],seq["step_families"])],dtype=bool)


def group_split(seq, tm, holdout):
    touched=touches_holdout(seq,holdout); blocked=set()
    for t in seq["cutoff"][touched].tolist():
        for k in range(-EMBARGO_STEPS,EMBARGO_STEPS+1): blocked.add(int(t+60*k))
    overlap=np.asarray([int(t) in blocked for t in seq["cutoff"]],dtype=bool)
    dev=~touched & ~overlap
    return {"train":tm["train"]&dev,"calibration":tm["calibration"]&dev,"policy":tm["policy"]&dev,"negative":tm["test"]&seq["clean"]&(seq["y"]==0),"touched":touched,"overlap":overlap}


def fit_transform(train_x, train_f, arrays):
    joint=np.concatenate([train_x.reshape(-1,train_x.shape[-1]),train_f.reshape(-1,train_f.shape[-1])]).astype(np.float64); joint[~np.isfinite(joint)]=np.nan
    med=np.nanmedian(joint,axis=0); med[~np.isfinite(med)]=0
    def imp(a):
        z=np.asarray(a,dtype=np.float32).copy(); bad=~np.isfinite(z)
        if bad.any(): z[bad]=med[np.where(bad)[-1]]
        return z
    ti=imp(train_x); fi=imp(train_f); scaler=StandardScaler().fit(np.concatenate([ti.reshape(-1,ti.shape[-1]),fi.reshape(-1,fi.shape[-1])]))
    out=[]
    for a in arrays:
        z=imp(a); out.append(scaler.transform(z.reshape(-1,z.shape[-1])).reshape(z.shape).astype(np.float32))
    return out


def train_world(X,F,tr_mask,va_mask,seed,epochs=12):
    import torch, torch.nn as nn
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed); torch.set_num_threads(2)
    tr=np.where(tr_mask)[0]; va=np.where(va_mask)[0]
    if len(tr)<50 or len(va)<20: raise ValueError(f"state support train={len(tr)} val={len(va)}")
    Xs,Fs=fit_transform(X[tr],F[tr],[X,F])
    class W(nn.Module):
        def __init__(self,d):
            super().__init__(); self.rnn=nn.LSTM(d,32,batch_first=True); self.head=nn.Sequential(nn.Linear(32,64),nn.ReLU(),nn.Linear(64,HORIZON*d))
        def forward(self,x):
            _,(h,_)=self.rnn(x); return self.head(h[-1]).reshape(len(x),HORIZON,x.shape[-1])
    m=W(X.shape[-1]); opt=torch.optim.Adam(m.parameters(),lr=.003); loss=nn.MSELoss(); xtr=torch.tensor(Xs[tr]); ftr=torch.tensor(Fs[tr]); xva=torch.tensor(Xs[va]); fva=torch.tensor(Fs[va])
    best=None; best_state=None; stale=0; rng=np.random.default_rng(seed)
    for _ in range(epochs):
        order=rng.permutation(len(tr)); m.train()
        for st in range(0,len(order),256):
            ids=order[st:st+256]; p=m(xtr[ids]); l=loss(p,ftr[ids]); opt.zero_grad(); l.backward(); opt.step()
        m.eval()
        with torch.no_grad(): val=float(loss(m(xva),fva).item())
        if best is None or val<best-1e-7: best=val; best_state={k:v.detach().cpu().clone() for k,v in m.state_dict().items()}; stale=0
        else:
            stale+=1
            if stale>=5: break
    m.load_state_dict(best_state); m.eval()
    with torch.no_grad(): pred=m(torch.tensor(Xs)).cpu().numpy()
    pers=np.repeat(Xs[:,-1:,:],HORIZON,axis=1)
    vm=float(np.mean((pred[va]-Fs[va])**2)); vp=float(np.mean((pers[va]-Fs[va])**2))
    return {"pred":pred,"future":Fs,"persistence":pers,"validation_mse":vm,"validation_persistence_mse":vp,"state_gate_passed":bool(vm<vp)}


def tail_evidence(cal,values):
    cal=np.asarray(cal,float); x=np.asarray(values,float); cal=cal[np.isfinite(cal)]; ordered=np.sort(cal); idx=np.searchsorted(ordered,x,side="left"); tail=len(ordered)-idx; p=(1.0+tail)/(len(ordered)+1.0); return -np.log10(np.maximum(p,1e-12))


def logistic_score(X,target,tr_mask,seed):
    tr=np.where(tr_mask)[0]; flat=X.reshape(len(X),-1).astype(np.float64); flat[~np.isfinite(flat)]=np.nan; med=np.nanmedian(flat[tr],axis=0); med[~np.isfinite(med)]=0; bad=~np.isfinite(flat); flat[bad]=med[np.where(bad)[1]]
    sc=StandardScaler().fit(flat[tr]); z=sc.transform(flat); model=LogisticRegression(max_iter=1000,class_weight="balanced",random_state=seed,solver="liblinear"); model.fit(z[tr],target[tr]); return model.predict_proba(z)[:,1]


def fpr_threshold(scores,budget):
    s=np.sort(np.asarray(scores,float))[::-1]
    if not len(s): return None
    allowed=int(math.floor(budget*len(s)))
    if allowed<=0:return float(np.nextafter(s[0],np.inf))
    if allowed>=len(s):return float(s[-1])
    return float(np.nextafter(s[allowed],np.inf))


def metrics(pos,neg,score,th):
    ids=np.where(pos|neg)[0]
    if int(pos.sum())==0 or int(neg.sum())==0:return {"positive_support":int(pos.sum()),"negative_support":int(neg.sum()),"recall":None,"fpr":None,"precision":None,"f1":None}
    y=pos[ids].astype(int); p=score[ids]>=th; tn,fp,fn,tp=confusion_matrix(y,p,labels=[0,1]).ravel()
    return {"positive_support":int(pos.sum()),"negative_support":int(neg.sum()),"tp":int(tp),"fn":int(fn),"fp":int(fp),"tn":int(tn),"recall":float(tp/(tp+fn)),"fpr":float(fp/(fp+tn)),"precision":float(tp/(tp+fp)) if tp+fp else None,"f1":float(f1_score(y,p,zero_division=0))}


def family_future(seq,fam):
    hist=np.asarray([fam in x for x in seq["history_families"]],bool); future=np.zeros((len(hist),HORIZON),bool)
    for i,steps in enumerate(seq["step_families"]):
        for h,s in enumerate(steps): future[i,h]=fam in s
    return hist,future


def onset_events(seq,fam,score,th,allowed=None):
    allow=np.ones(len(score),bool) if allowed is None else allowed; groups=defaultdict(list)
    for i in range(len(score)):
        if not allow[i] or not seq["clean"][i] or fam in seq["history_families"][i]: continue
        fh=None
        for h,s in enumerate(seq["step_families"][i]):
            if fam in s: fh=h; break
        if fh is None: continue
        onset=int(seq["cutoff"][i]+60*(fh+1)); groups[(str(seq["src"][i]),onset)].append({"lead":60*(fh+1),"alert":bool(score[i]>=th),"cutoff":int(seq["cutoff"][i])})
    events=[]
    for (src,onset),cand in sorted(groups.items(),key=lambda x:(x[0][1],x[0][0])):
        fired=[x for x in cand if x["alert"]]; best=max(fired,key=lambda x:x["lead"]) if fired else None
        events.append({"source":src,"onset_epoch":onset,"warning":best is not None,"lead_seconds":int(best["lead"]) if best else None})
    hits=[e for e in events if e["warning"]]; leads=[e["lead_seconds"] for e in hits]
    return {"events":len(events),"hits":len(hits),"event_recall":len(hits)/len(events) if events else None,"mean_lead_minutes":float(np.mean(leads)/60) if leads else None,"median_lead_minutes":float(np.median(leads)/60) if leads else None,"min_lead_minutes":float(np.min(leads)/60) if leads else None,"max_lead_minutes":float(np.max(leads)/60) if leads else None,"lead_histogram_minutes":{str(m):sum(1 for x in leads if x==60*m) for m in (1,2,3,4)}},events


def mean_sd(vals):
    v=[float(x) for x in vals if x is not None and np.isfinite(x)]; return {"mean":float(np.mean(v)) if v else None,"sd":float(np.std(v,ddof=1)) if len(v)>1 else None}


def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--csv",required=True); ap.add_argument("--out",required=True); ap.add_argument("--epochs",type=int,default=12); args=ap.parse_args()
    out=Path(args.out); out.mkdir(parents=True,exist_ok=True); df=pd.read_csv(args.csv,low_memory=False); dt,time_method=parse_time(df); y,family,bcol,fcol,profiles=detect_labels(df); feats=choose_features(df); state,state_feats,src_col=build_state(df,dt,y,family,feats); seq=make_sequences(state,state_feats); tm,bounds=temporal_masks(seq["cutoff"])
    available=sorted({x for steps in seq["step_families"] for s in steps for x in s}); hold=[x for x in HOLDOUT if x in available]
    if len(hold)!=len(HOLDOUT): raise RuntimeError(f"requested holdout missing. requested={HOLDOUT}, available={available}")
    split=group_split(seq,tm,hold); support={k:int(v.sum()) for k,v in split.items() if isinstance(v,np.ndarray)}
    result={"protocol":"fresh Ransomware+RDoS zero-exposure Garuda stress","source":{"sha256":sha256(args.csv),"rows":len(df),"columns":len(df.columns)},"holdout_families":hold,"available_families":available,"history_minutes":HISTORY,"horizon_minutes":HORIZON,"policy_budget":POLICY_BUDGET,"features":feats,"state_feature_count":len(state_feats),"label_columns":{"binary":bcol,"family":fcol,"profiles":profiles},"time_method":time_method,"boundaries":bounds,"support":support,"seeds":{}}
    for seed in SEEDS:
        w=train_world(seq["X"],seq["future"],split["train"],split["calibration"],seed,args.epochs); cal=split["calibration"]&seq["clean"]&(seq["y"]==0); pol=split["policy"]&seq["clean"]&(seq["y"]==0)
        logit=logistic_score(seq["X"],seq["y"],split["train"],seed); energy=np.mean((w["pred"]-w["persistence"])**2,axis=(1,2)); le=tail_evidence(logit[cal],logit); ee=tail_evidence(energy[cal],energy); score=.75*le+.25*ee; th=fpr_threshold(score[pol],POLICY_BUDGET)
        row={"threshold":th,"state":{"validation_mse":w["validation_mse"],"validation_persistence_mse":w["validation_persistence_mse"],"gate":w["state_gate_passed"]},"families":{}}
        for fam in hold:
            hist,fut=family_future(seq,fam); anyf=fut.any(axis=1); allm=metrics(anyf,split["negative"],score,th); strict=metrics(tm["test"]&anyf,split["negative"],score,th); onset,events=onset_events(seq,fam,score,th); strict_onset,_=onset_events(seq,fam,score,th,tm["test"])
            row["families"][fam]={"all_episode":allm,"strict_tail":strict,"clean_onset":onset,"strict_tail_clean_onset":strict_onset,"reference_gate":bool(w["state_gate_passed"] and allm.get("fpr") is not None and allm["fpr"]<=FPR_BUDGET and allm.get("recall") is not None and allm["recall"]>=.80)}
            (out/f"seed_{seed}_{fam}_events.json").write_text(json.dumps(events,indent=2)+"\n")
        result["seeds"][str(seed)]=row
    summary={}
    for fam in hold:
        rows=[result["seeds"][str(s)]["families"][fam] for s in SEEDS]
        summary[fam]={"recall":mean_sd([r["all_episode"]["recall"] for r in rows]),"fpr":mean_sd([r["all_episode"]["fpr"] for r in rows]),"strict_tail_recall":mean_sd([r["strict_tail"]["recall"] for r in rows]),"clean_onset_event_recall":mean_sd([r["clean_onset"]["event_recall"] for r in rows]),"clean_onset_mean_lead_minutes":mean_sd([r["clean_onset"]["mean_lead_minutes"] for r in rows]),"clean_onset_median_lead_minutes":mean_sd([r["clean_onset"]["median_lead_minutes"] for r in rows]),"event_support":rows[0]["clean_onset"]["events"],"strict_tail_event_support":rows[0]["strict_tail_clean_onset"]["events"],"gate_all_seeds":all(r["reference_gate"] for r in rows)}
    result["summary"]=summary; result["claim_boundary"]="Fresh zero-supervised-exposure model run for Ransomware and RDoS on public X-IIoTID traces. This is not a real undisclosed production zero-day and lead time is to dataset family onset, not successful compromise."; (out/"summary.json").write_text(json.dumps(result,indent=2,allow_nan=False)+"\n"); print(json.dumps(summary,indent=2))

if __name__=="__main__": main()
