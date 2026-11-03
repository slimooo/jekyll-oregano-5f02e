"""IC annuel moyen (méthode Fama-MacBeth) de chaque critère et de chaque catégorie, sur les formations annuelles.

Usage : python3 -I criteria_ic.py --data DIR --scores scores_annual.jsonl --end 2026-10-30 --out criteria_ic.json
"""
import argparse, json, math, os, sys
import numpy as np
import pandas as pd
from scipy import stats
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from evaluate import load_tr, value_at  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True); ap.add_argument("--scores", required=True)
    ap.add_argument("--end", required=True); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    sc = pd.DataFrame([json.loads(l) for l in open(a.scores) if l.strip()])
    sc = sc[~sc.gone & sc.symbol.notna() & (sc.marketCap >= 3e8)]
    dates = sorted(sc.asOf.unique())
    tr = load_tr(a.data, sc.symbol.unique().tolist(), dates[0], a.end); spy = tr["SPY"]
    ics = {}
    for i, d0 in enumerate(dates):
        F = pd.Timestamp(d0); T = pd.Timestamp(dates[i + 1]) if i + 1 < len(dates) else pd.Timestamp(a.end)
        d = sc[sc.asOf == d0].copy()
        def ret(s):
            t = tr.get(s)
            if t is None or t.index[0] > F + pd.Timedelta(days=7): return np.nan
            v0 = value_at(t, F); last = t.index[-1]
            if last >= T: return value_at(t, T) / v0 - 1
            return (float(t.iloc[-1]) / v0) * (value_at(spy, T) / value_at(spy, last)) - 1
        d["ret"] = d.symbol.map(ret); d = d[d.ret.notna()]
        feats = {"score": d.score}
        for c in ["dividend", "debt", "cash", "value", "revenue", "ebitda", "quality", "peers"]:
            feats["cat:" + c] = d.categories.map(lambda x: x.get(c))
        for k in sorted({k for x in d.criteria for k in x}):
            feats[k] = d.criteria.map(lambda x: x.get(k))
        for k, v in feats.items():
            v = pd.to_numeric(v, errors="coerce"); ok = v.notna()
            if ok.sum() >= 100 and v[ok].nunique() > 2:
                ics.setdefault(k, []).append(float(stats.spearmanr(v[ok], d.ret[ok])[0]))
    out = {k: {"mean": float(np.mean(v)), "t": float(np.mean(v) / (np.std(v, ddof=1) / math.sqrt(len(v)))) if len(v) > 2 else None,
               "years": len(v), "positive_years": int(sum(x > 0 for x in v))} for k, v in ics.items()}
    json.dump(out, open(a.out, "w"), indent=1)
    for k, v in sorted(out.items(), key=lambda kv: -kv[1]["mean"]):
        print(f"{k:16s} IC moyen {v['mean']:+.3f}  t={v['t']:+.2f}  années positives {v['positive_years']}/{v['years']}")


if __name__ == "__main__":
    main()
