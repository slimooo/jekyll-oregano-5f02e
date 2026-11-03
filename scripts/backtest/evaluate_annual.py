"""Robustesse : formations annuelles (chaque fin octobre), portefeuilles équipondérés détenus un an puis
rééquilibrés. Séries mensuelles chaînées, CAGR, volatilité, perte maximale, alpha CAPM et Fama-French 5+momentum,
corrélation de rang annuelle (IC) avec sa moyenne et son t de Student (méthode Fama-MacBeth).

Usage : python3 -I evaluate_annual.py --data DIR --scores scores.jsonl --end 2026-10-30 --out annual.json [--label v1]
"""
import argparse, json, math, os, sys

import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from evaluate import load_tr, growth_path, month_ends, perf, regress, load_french  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True); ap.add_argument("--scores", required=True)
    ap.add_argument("--end", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--min-mcap", type=float, default=3e8); ap.add_argument("--label", default="")
    ap.add_argument("--large", action="store_true", help="grandes capitalisations uniquement (>= 10 Md$)")
    a = ap.parse_args()
    sc = pd.DataFrame([json.loads(l) for l in open(a.scores) if l.strip()])
    sc = sc[~sc.gone & sc.symbol.notna() & (sc.marketCap >= (1e10 if a.large else a.min_mcap))]
    dates = sorted(sc.asOf.unique())
    bounds = [(pd.Timestamp(d), pd.Timestamp(dates[i + 1]) if i + 1 < len(dates) else pd.Timestamp(a.end)) for i, d in enumerate(dates)]
    tr = load_tr(a.data, sc.symbol.unique().tolist(), dates[0], a.end)
    spy = tr["SPY"]
    ff = load_french(a.data)
    groups = ["buy", "watch", "avoid", "Q1", "Q2", "Q3", "Q4", "Q5", "univers"]
    monthly = {g: [] for g in groups + ["SPY"]}
    months, years, ics, ics_sec = [], [], [], []
    for (F, T), d0 in zip(bounds, dates):
        d = sc[sc.asOf == d0].copy()
        md = month_ends(F, T)
        paths = {}
        for s in d.symbol:
            if s in tr:
                p = growth_path(tr[s], spy, F, md)
                if p is not None and np.all(np.isfinite(p)): paths[s] = p
        d = d[d.symbol.isin(paths)].copy()
        if len(d) < 50: continue
        d["ret"] = d.symbol.map(lambda s: paths[s][-1] - 1)
        d["q"] = pd.qcut(d.score.rank(method="first"), 5, labels=False) + 1
        rho = stats.spearmanr(d.score, d.ret)[0]; ics.append(float(rho))
        ds = d.copy(); ds["r"] = ds.ret - ds.groupby("sector").ret.transform("mean"); ds["s"] = ds.score - ds.groupby("sector").score.transform("mean")
        ics_sec.append(float(stats.spearmanr(ds.s, ds.r)[0]))
        sel = {"buy": d.verdictLevel == "buy", "watch": d.verdictLevel == "watch", "avoid": d.verdictLevel == "avoid",
               **{f"Q{k}": d.q == k for k in range(1, 6)}, "univers": d.ret.notna()}
        sp = growth_path(spy, spy, F, md)
        yr = {"start": d0, "n": int(len(d)), "ic": float(rho), "SPY": float(sp[-1] - 1)}
        for g, m in sel.items():
            syms = d[m].symbol.tolist()
            if not syms:
                P = sp  # groupe vide : on suppose l'argent placé sur le SPY
            else:
                P = np.mean([paths[s] for s in syms], axis=0)
            monthly[g] += list(P[1:] / P[:-1] - 1)
            yr[g] = float(P[-1] - 1); yr["n_" + g] = int(len(syms))
        monthly["SPY"] += list(sp[1:] / sp[:-1] - 1)
        months += [t.strftime("%Y%m") for t in md[1:]]
        years.append(yr)
    rf = np.array([ff.RF.get(ym, np.nan) for ym in months]); rf = np.where(np.isfinite(rf), rf, np.nanmean(rf[-6:]))
    keep = [i for i, ym in enumerate(months) if ym in ff.index and np.isfinite(ff.loc[ym, "Mom"])]
    X = ff.loc[[months[i] for i in keep], ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "Mom"]].values
    res = {"label": a.label, "start": dates[0], "end": a.end, "years": years,
           "ic_mean": float(np.mean(ics)), "ic_t": float(np.mean(ics) / (np.std(ics, ddof=1) / math.sqrt(len(ics)))),
           "ic_within_sector_mean": float(np.mean(ics_sec)), "ic_within_sector_t": float(np.mean(ics_sec) / (np.std(ics_sec, ddof=1) / math.sqrt(len(ics_sec)))),
           "groups": {}}
    dts = [pd.Timestamp(dates[0])] + [pd.Timestamp(m + "01") + pd.offsets.MonthEnd(0) for m in months]
    rs = np.array(monthly["SPY"])
    for g in groups + ["SPY"]:
        r = np.array(monthly[g]); path = np.concatenate([[1.0], np.cumprod(1 + r)])
        st = perf(path, dts, rf)
        st["capm"] = regress(r - rf, (rs - rf).reshape(-1, 1), ["mkt"])
        st["ff6"] = regress((r - rf)[keep], X, ["mkt", "smb", "hml", "rmw", "cma", "mom"])
        st["path"] = [float(v) for v in path]
        res["groups"][g] = st
    ls = np.array(monthly["Q5"]) - np.array(monthly["Q1"])
    res["q5_minus_q1"] = {"ann": float(ls.mean() * 12), "t": float(ls.mean() / (ls.std(ddof=1) / math.sqrt(len(ls))))}
    bs = np.array(monthly["buy"]) - np.array(monthly["avoid"])
    res["buy_minus_avoid"] = {"ann": float(bs.mean() * 12), "t": float(bs.mean() / (bs.std(ddof=1) / math.sqrt(len(bs))))}
    res["months"] = months
    json.dump(res, open(a.out, "w"), indent=1)
    p = lambda v: f"{v*100:6.1f} %"
    print(f"\n=== {a.label} : formations annuelles {dates[0]} -> {a.end} ({len(years)} ans){' — grandes capitalisations' if a.large else ''}")
    print(f"IC annuel moyen = {res['ic_mean']:+.3f} (t={res['ic_t']:.2f}) ; intra-secteur = {res['ic_within_sector_mean']:+.3f} (t={res['ic_within_sector_t']:.2f})")
    for g in groups + ["SPY"]:
        s = res["groups"][g]
        print(f"  {g:8s} TCAM={p(s['cagr'])} vol={p(s['vol'])} maxDD={p(s['maxDD'])} Sharpe={s['sharpe']:.2f}  alpha CAPM={p(s['capm']['alpha_ann'])} (t={s['capm']['alpha_t']:.2f})  alpha FF6={p(s['ff6']['alpha_ann'])} (t={s['ff6']['alpha_t']:.2f})  HML={s['ff6']['hml']['beta']:.2f} RMW={s['ff6']['rmw']['beta']:.2f}")
    print(f"  Q5-Q1 = {p(res['q5_minus_q1']['ann'])}/an (t={res['q5_minus_q1']['t']:.2f}) ; Achat-Éviter = {p(res['buy_minus_avoid']['ann'])}/an (t={res['buy_minus_avoid']['t']:.2f})")
    print("  année      n    IC     SPY    achat  étudier  éviter     Q1     Q5")
    for y in years:
        print(f"  {y['start'][:4]}   {y['n']:5d} {y['ic']:+.3f} {p(y['SPY'])} {p(y['buy'])} {p(y['watch'])} {p(y['avoid'])} {p(y['Q1'])} {p(y['Q5'])}")


if __name__ == "__main__":
    main()
