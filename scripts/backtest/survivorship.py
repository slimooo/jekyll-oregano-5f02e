"""Biais de survie : que disait l'algorithme, en 2016, des sociétés qui ont ensuite disparu de la cote ?

Les sociétés disparues (faillite, rachat…) n'ont plus de cours dans la source de prix : elles sont absentes
du backtest principal. Leurs comptes SEC restent disponibles : on calcule pour toutes les sociétés un score
« fondamentaux seuls » (critères de dette, trésorerie, chiffre d'affaires, EBITDA et qualité, hors critères
qui exigent un cours), avec les poids du moteur, puis on compare les taux de faillite et de rachat.

Usage : python3 -I survivorship.py --scores scores.jsonl --asof 2016-10-31 --out survivorship.json
"""
import argparse, json
import numpy as np
import pandas as pd

PRICE_FREE_CATS = ["debt", "cash", "revenue", "ebitda", "quality"]
NEEDS_PRICE = {"cash-level", "q-altman"}


def fundamentals_only(rec):
    W = rec["weights"]; num = den = 0.0
    # v1 : Altman Z (1968) utilise la capitalisation ; v2 : Z'' (1995) n'utilise que les comptes.
    needs_price = NEEDS_PRICE - ({"q-altman"} if "q-gpa" in W["criteria"] else set())
    for cat in PRICE_FREE_CATS:
        crit = [k for k, c in W["criterionCategory"].items() if c == cat and k not in needs_price and W["criteria"].get(k)]
        ok = [k for k in crit if rec["criteria"].get(k) is not None]
        w = sum(W["criteria"][k] for k in ok)
        if not w: continue
        cs = sum(rec["criteria"][k] * W["criteria"][k] for k in ok) / w * 10
        num += cs * W["categories"][cat]; den += W["categories"][cat]
    return num / den if den else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scores", required=True); ap.add_argument("--asof", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--min-size", type=float, default=3e8)
    a = ap.parse_args()
    d = pd.DataFrame([json.loads(l) for l in open(a.scores) if l.strip()])
    d = d[d.asOf == a.asof].copy()
    d["fos"] = d.apply(fundamentals_only, axis=1)
    # Taille : capitalisation (cotées) ou flottant SEC (disparues) ; flottants aberrants (erreurs d'échelle XBRL) écartés.
    scale = d.apply(lambda r: max([v for v in [(r.get("bs") or {}).get("ta"), (r.get("bs") or {}).get("rev")] if v] or [np.nan]), axis=1)
    pf = d.publicFloat.where(~(d.publicFloat > 30 * scale), np.nan)
    d["size"] = np.where(d.gone, pf, d.marketCap)
    d = d[(d["size"] >= a.min_size) & ~d.delistedBeforeF.fillna(False) & d.fos.notna()].copy()
    d["status"] = np.where(~d.gone, "coté en 2026", d.exit.fillna("unknown").map(
        {"bankruptcy": "faillite", "merger": "rachat/fusion", "other": "retrait (autre)", "unknown": "retrait (inconnu)"}))
    d["q"] = pd.qcut(d.fos.rank(method="first"), 5, labels=False) + 1
    tab = pd.crosstab(d.q, d.status, normalize="index")
    cnt = pd.crosstab(d.q, d.status)
    rng = d.groupby("q").fos.agg(["min", "max", "count"])
    res = {"asOf": a.asof, "n": int(len(d)), "by_status": d.status.value_counts().to_dict(),
           "fos_mean_by_status": d.groupby("status").fos.mean().round(1).to_dict(),
           "fos_median_by_status": d.groupby("status").fos.median().round(1).to_dict(),
           "quintiles": {int(q): {"range": [float(rng.loc[q, "min"]), float(rng.loc[q, "max"])], "n": int(rng.loc[q, "count"]),
                                  **{k: float(v) for k, v in tab.loc[q].items()}} for q in tab.index},
           "bankrupt_names": d[d.status == "faillite"].sort_values("size", ascending=False).head(25)[["name", "fos", "size"]].to_dict("records")}
    # Les drapeaux rouges « fondamentaux » (pertes, Piotroski faible…) précédaient-ils les faillites ?
    d["flag"] = d.redFlags.map(lambda f: any(("Perte" in x) or ("Piotroski" in x) or ("Capitaux propres" in x) for x in f))
    res["bankruptcy_rate_flagged"] = float((d[d.flag].status == "faillite").mean())
    res["bankruptcy_rate_not_flagged"] = float((d[~d.flag].status == "faillite").mean())
    # Pouvoir de prédiction de chaque critère « sans cours » sur la faillite (AUC : 0,5 = hasard, 1 = parfait)
    from scipy.stats import mannwhitneyu
    auc = {}
    y = (d.status == "faillite").values
    W0 = d.weights.iloc[0]
    price_free = {k for k, c in W0["criterionCategory"].items() if c in PRICE_FREE_CATS} - (NEEDS_PRICE - ({"q-altman"} if "q-gpa" in W0["criteria"] else set()))
    for k in sorted(price_free):  # critères calculables sans cours ni historique de dividendes
        v = d.criteria.map(lambda c: c.get(k)).astype(float).values
        ok = np.isfinite(v)
        if ok.sum() > 200 and y[ok].sum() >= 10:
            u = mannwhitneyu(v[ok][~y[ok]], v[ok][y[ok]]).statistic
            auc[k] = {"auc": float(u / ((~y[ok]).sum() * y[ok].sum())), "n": int(ok.sum()), "n_bankrupt": int(y[ok].sum())}
    v = d.fos.values; u = mannwhitneyu(v[~y], v[y]).statistic
    auc["score_fondamentaux"] = {"auc": float(u / ((~y).sum() * y.sum())), "n": int(len(d)), "n_bankrupt": int(y.sum())}
    res["bankruptcy_auc"] = auc
    json.dump(res, open(a.out, "w"), indent=1, default=float)
    print(f"Sociétés (taille >= {a.min_size/1e6:.0f} M$) au {a.asof} : {len(d)}")
    print(d.status.value_counts().to_string())
    print("\nScore « fondamentaux seuls » moyen par devenir :", res["fos_mean_by_status"])
    print("\nRépartition par quintile de score (Q1 = plus faible) :")
    print((tab * 100).round(1).to_string()); print(cnt.to_string())
    print(f"\nTaux de faillite : {res['bankruptcy_rate_flagged']*100:.1f} % avec drapeau rouge fondamental vs {res['bankruptcy_rate_not_flagged']*100:.1f} % sans")
    print("AUC faillite (critère élevé = sain) :", {k: round(v["auc"], 3) for k, v in sorted(auc.items(), key=lambda kv: -kv[1]["auc"])})


if __name__ == "__main__":
    main()
