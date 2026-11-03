"""Évalue les scores historiques : rendements totaux ultérieurs (dividendes réinvestis), portefeuilles
par verdict et par quintile, comparaison au S&P 500 (SPY), pouvoir prédictif (corrélation de rang),
régressions CAPM et Fama-French 5 facteurs + momentum.

Usage : python3 -I evaluate.py --data DIR --scores scores.jsonl --start 2016-10-31 --end 2026-10-30 --out results.json
"""
import argparse, json, math, os, sys
from datetime import date

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from scipy import stats
import statsmodels.api as sm


def load_tr(data, symbols, start, end):
    """Indice de rendement total quotidien (cours ajustés des splits/scissions + dividendes réinvestis)."""
    H = os.path.join(data, "hf_defeatbeta")
    syms = sorted(set(symbols) | {"SPY"})
    t = pq.read_table(f"{H}/stock_prices.parquet", columns=["symbol", "report_date", "close"],
                      filters=[("symbol", "in", syms), ("report_date", ">=", (pd.Timestamp(start) - pd.Timedelta(days=10)).strftime("%Y-%m-%d")),
                               ("report_date", "<=", end)])
    px = t.to_pandas(); px["close"] = px.close.astype(float); px["report_date"] = pd.to_datetime(px.report_date)
    dv = pd.read_parquet(f"{H}/stock_dividend_events.parquet"); dv = dv[dv.symbol.isin(syms)]
    dv["amount"] = dv.amount.astype(float); dv["report_date"] = pd.to_datetime(dv.report_date)
    out = {}
    for s, g in px.groupby("symbol"):
        g = g.sort_values("report_date").drop_duplicates("report_date").set_index("report_date").close
        g = g[g > 0]
        if len(g) < 2: continue
        d = dv[dv.symbol == s].groupby("report_date").amount.sum()
        # dividende détaché un jour sans cotation : rattaché à la séance suivante
        dd = pd.Series(0.0, index=g.index)
        for day, amt in d.items():
            pos = g.index.searchsorted(day)
            if pos < len(g.index): dd.iloc[pos] += amt
        r = (g + dd) / g.shift(1)
        r.iloc[0] = 1.0
        out[s] = r.cumprod()
    return out


def month_ends(start, end):
    idx = pd.date_range(start, end, freq="BME")
    return [pd.Timestamp(start)] + [d for d in idx if d > pd.Timestamp(start)] + ([pd.Timestamp(end)] if idx[-1] < pd.Timestamp(end) else [])


def value_at(tr, t):
    """Valeur de l'indice au dernier jour coté <= t."""
    pos = tr.index.searchsorted(t, side="right") - 1
    return None if pos < 0 else float(tr.iloc[pos])


def growth_path(tr, spy, F, dates):
    """Croissance de 1 investi à F ; après la dernière cotation (rachat, retrait de la cote),
    le produit est réinvesti dans le SPY jusqu'à la fin."""
    v0 = value_at(tr, F)
    if v0 is None or tr.index[0] > F + pd.Timedelta(days=7): return None
    last = tr.index[-1]
    vl = float(tr.iloc[-1]) / v0
    out = []
    for t in dates:
        if t <= last: out.append(value_at(tr, t) / v0)
        else: out.append(vl * value_at(spy, t) / value_at(spy, last))
    return np.array(out)


def load_french(data):
    base = os.path.join(data, "french", "csv")
    def monthly(fname):
        rows, cols, started = [], None, False
        for line in open(os.path.join(base, fname), encoding="latin-1"):
            line = line.rstrip("\n")
            if line.startswith(",") and not started:
                cols = [c.strip() for c in line.split(",")[1:]]; started = True; continue
            if started:
                parts = [p.strip() for p in line.split(",")]
                if len(parts[0]) == 6 and parts[0].isdigit():
                    rows.append([parts[0]] + [float(p) for p in parts[1:len(cols) + 1]])
                elif rows: break
        df = pd.DataFrame(rows, columns=["ym"] + cols).set_index("ym") / 100.0
        return df
    ff = monthly("F-F_Research_Data_5_Factors_2x3.csv")
    mom = monthly("F-F_Momentum_Factor.csv"); mom.columns = ["Mom"]
    return ff.join(mom, how="left")


def perf(path, dates, rf_m=None):
    v = np.asarray(path, dtype=float)
    r = v[1:] / v[:-1] - 1
    years = (dates[-1] - dates[0]).days / 365.25
    cagr = v[-1] ** (1 / years) - 1
    vol = float(np.std(r, ddof=1) * math.sqrt(12))
    peak = np.maximum.accumulate(v); mdd = float(np.min(v / peak - 1))
    ex = r - (rf_m if rf_m is not None else 0.0)
    sharpe = float(np.mean(ex) * 12 / (np.std(ex, ddof=1) * math.sqrt(12))) if len(ex) > 2 else None
    return {"cagr": float(cagr), "total": float(v[-1] - 1), "vol": vol, "maxDD": mdd, "sharpe": sharpe}


def regress(y, X, names):
    Xc = sm.add_constant(X)
    m = sm.OLS(y, Xc).fit(cov_type="HAC", cov_kwds={"maxlags": 6})
    res = {"alpha_ann": float(m.params[0] * 12), "alpha_t": float(m.tvalues[0]), "r2": float(m.rsquared)}
    for i, n in enumerate(names): res[n] = {"beta": float(m.params[i + 1]), "t": float(m.tvalues[i + 1])}
    return res


def spearman(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ok = np.isfinite(a) & np.isfinite(b)
    if ok.sum() < 20: return None
    rho, p = stats.spearmanr(a[ok], b[ok])
    return {"rho": float(rho), "p": float(p), "n": int(ok.sum())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True); ap.add_argument("--scores", required=True)
    ap.add_argument("--start", required=True); ap.add_argument("--end", required=True)
    ap.add_argument("--out", required=True); ap.add_argument("--min-mcap", type=float, default=3e8)
    ap.add_argument("--label", default="")
    args = ap.parse_args()
    F, T = pd.Timestamp(args.start), pd.Timestamp(args.end)
    sc = pd.DataFrame([json.loads(l) for l in open(args.scores) if l.strip()])
    sc = sc[(sc.asOf == args.start)]
    listed = sc[~sc.gone & sc.symbol.notna() & (sc.marketCap >= args.min_mcap)].copy()
    tr = load_tr(args.data, listed.symbol.tolist(), args.start, args.end)
    spy = tr["SPY"]
    dates = month_ends(F, T)
    paths, rets = {}, {}
    for s in listed.symbol:
        if s not in tr: continue
        p = growth_path(tr[s], spy, F, dates)
        if p is None or not np.all(np.isfinite(p)): continue
        paths[s] = p; rets[s] = p[-1] - 1
    listed = listed[listed.symbol.isin(rets)].copy()
    years = (T - F).days / 365.25
    listed["ret"] = listed.symbol.map(rets)
    listed["ann"] = (1 + listed.ret) ** (1 / years) - 1
    listed["delisted"] = listed.symbol.map(lambda s: tr[s].index[-1] < T - pd.Timedelta(days=10))
    spy_path = growth_path(spy, spy, F, dates)
    spy_tot = spy_path[-1] - 1; spy_ann = (1 + spy_tot) ** (1 / years) - 1
    ff = load_french(args.data)
    yms = [d.strftime("%Y%m") for d in dates[1:]]
    rf_m = np.array([ff.RF.get(ym, np.nan) for ym in yms]); rf_m = np.where(np.isfinite(rf_m), rf_m, np.nanmean(rf_m[-6:]))

    def group_stats(g):
        if len(g) == 0: return None
        P = np.mean([paths[s] for s in g.symbol], axis=0)
        w = g.marketCap.values / g.marketCap.sum()
        Pvw = np.sum([wi * paths[s] for wi, s in zip(w, g.symbol)], axis=0)
        st = perf(P, dates, rf_m)
        st["vw"] = perf(Pvw, dates, rf_m)
        st["vw"]["capm"] = regress(Pvw[1:] / Pvw[:-1] - 1 - rf_m, (spy_path[1:] / spy_path[:-1] - 1 - rf_m).reshape(-1, 1), ["mkt"])
        st["vw"]["path"] = [float(x) for x in Pvw]
        st.update({"n": int(len(g)), "mean_ann_stock": float(g.ann.mean()), "median_ann_stock": float(g.ann.median()),
                   "pct_beat_spy": float((g.ret > spy_tot).mean()), "pct_loss": float((g.ret < 0).mean()),
                   "pct_lost_half": float((g.ret < -0.5).mean()), "median_mcap": float(g.marketCap.median())})
        r = P[1:] / P[:-1] - 1; rs = spy_path[1:] / spy_path[:-1] - 1
        st["capm"] = regress(r - rf_m, (rs - rf_m).reshape(-1, 1), ["mkt"])
        keep = [i for i, ym in enumerate(yms) if ym in ff.index and np.isfinite(ff.loc[ym, "Mom"])]
        if len(keep) > 24:
            X = ff.loc[[yms[i] for i in keep], ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "Mom"]].values
            st["ff6"] = regress((r - rf_m)[keep], X, ["mkt", "smb", "hml", "rmw", "cma", "mom"])
        st["path"] = [float(x) for x in P]
        return st

    res = {"label": args.label, "start": args.start, "end": args.end, "years": years, "n_universe": int(len(listed)),
           "n_delisted_after_2025": int(listed.delisted.sum()), "dates": [d.strftime("%Y-%m-%d") for d in dates],
           "spy": {**perf(spy_path, dates, rf_m), "path": [float(x) for x in spy_path]}}
    res["equal_weight_universe"] = group_stats(listed)
    segs = {"all": listed, "large": listed[listed.marketCap >= 1e10], "top500": listed.nlargest(500, "marketCap")}
    for seg, d in segs.items():
        out = {"n": int(len(d))}
        out["verdict"] = {v: group_stats(d[d.verdictLevel == v]) for v in ["buy", "watch", "avoid"]}
        out["verdict_detail"] = {v: group_stats(d[d.verdict == v]) for v in sorted(d.verdict.unique())}
        d = d.copy(); d["q"] = pd.qcut(d.score.rank(method="first"), 5, labels=False) + 1
        out["quintile"] = {int(k): group_stats(d[d.q == k]) for k in range(1, 6)}
        out["quintile_score_range"] = {int(k): [float(d[d.q == k].score.min()), float(d[d.q == k].score.max())] for k in range(1, 6)}
        P5, P1 = np.mean([paths[s] for s in d[d.q == 5].symbol], axis=0), np.mean([paths[s] for s in d[d.q == 1].symbol], axis=0)
        ls = (P5[1:] / P5[:-1]) - (P1[1:] / P1[:-1])
        out["q5_minus_q1"] = {"mean_monthly": float(ls.mean()), "ann": float(ls.mean() * 12), "t": float(ls.mean() / (ls.std(ddof=1) / math.sqrt(len(ls))))}
        out["ic_score"] = spearman(d.score, d.ann)
        dm = d.copy(); dm["ann_sec"] = dm.ann - dm.groupby("sector").ann.transform("mean")
        dm["score_sec"] = dm.score - dm.groupby("sector").score.transform("mean")
        out["ic_score_within_sector"] = spearman(dm.score_sec, dm.ann_sec)
        out["ic_category"] = {c: spearman(d.categories.map(lambda x: x.get(c)), d.ann) for c in ["dividend", "debt", "cash", "value", "revenue", "ebitda", "quality", "peers"]}
        crit_ids = sorted({k for x in d.criteria for k in x})
        out["ic_criterion"] = {c: spearman(d.criteria.map(lambda x: x.get(c)), d.ann) for c in crit_ids}
        out["ic_criterion_within_sector"] = {}
        for c in crit_ids:
            v = d.criteria.map(lambda x: x.get(c)).astype(float)
            vs = v - v.groupby(d.sector).transform("mean")
            out["ic_criterion_within_sector"][c] = spearman(vs, dm.ann_sec)
        out["ic_metric"] = {m: spearman(d.metrics.map(lambda x: x.get(m)), d.ann) for m in ["pe", "pb", "evEbitda", "dy", "roe", "netMargin", "de", "mos", "divYears"]}
        res[seg] = out
    # meilleurs et pires titres « Achat pertinent »
    b = listed[listed.verdictLevel == "buy"].sort_values("ann")
    res["buy_worst"] = b.head(10)[["symbol", "name", "score", "ann"]].to_dict("records")
    res["buy_best"] = b.tail(10)[["symbol", "name", "score", "ann"]].to_dict("records")
    top = listed.sort_values("ann").tail(25)
    res["top_performers"] = top[["symbol", "name", "score", "verdictLevel", "ann"]].to_dict("records")
    json.dump(res, open(args.out, "w"), indent=1, default=float)
    # résumé lisible
    p = lambda v: "n.d." if v is None else f"{v*100:6.1f} %"
    print(f"\n=== {args.label}  {args.start} -> {args.end}  ({years:.1f} ans)  univers : {len(listed)} actions US >= {args.min_mcap/1e6:.0f} M$")
    print(f"SPY (S&P 500, dividendes réinvestis) : {p(spy_ann)}/an   | moyenne équipondérée de l'univers : {p(res['equal_weight_universe']['cagr'])}/an")
    for seg in ["all", "large", "top500"]:
        o = res[seg]
        print(f"-- segment {seg} (n={o['n']})  IC score={o['ic_score']}  IC intra-secteur={o['ic_score_within_sector']}")
        for v in ["buy", "watch", "avoid"]:
            g = o["verdict"][v]
            if g: print(f"   {v:6s} n={g['n']:4d}  TCAM équipondéré={p(g['cagr'])}  pondéré capi={p(g['vw']['cagr'])}  médiane titre={p(g['median_ann_stock'])}  bat SPY={g['pct_beat_spy']*100:5.1f} %  vol={p(g['vol'])}  maxDD={p(g['maxDD'])}  alpha FF6={p(g['ff6']['alpha_ann'])} (t={g['ff6']['alpha_t']:.2f})")
        for k in range(1, 6):
            g = o["quintile"][k]
            print(f"   Q{k} score {o['quintile_score_range'][k]}  n={g['n']:4d}  TCAM={p(g['cagr'])}  pondéré capi={p(g['vw']['cagr'])}  médiane={p(g['median_ann_stock'])}  bat SPY={g['pct_beat_spy']*100:5.1f} %")
        print(f"   Q5-Q1 : {p(o['q5_minus_q1']['ann'])}/an (t={o['q5_minus_q1']['t']:.2f})")


if __name__ == "__main__":
    main()
