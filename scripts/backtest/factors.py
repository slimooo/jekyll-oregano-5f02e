"""Performance des facteurs académiques qui fondent les critères de l'app (données CRSP de Ken French,
sans biais de survie) : valeur (E/P, B/M, CF/P), rendement du dividende (D/P), rentabilité (OP),
investissement (INV), émissions nettes d'actions (NI), accruals (AC) et facteurs Fama-French.

Usage : python3 -I factors.py --data DIR --out factors.json
"""
import argparse, json, math, os
import numpy as np
import pandas as pd


def sections(path):
    """Lit un fichier Ken French : renvoie {titre de section: DataFrame mensuel (en fraction)}."""
    out, title, cols, rows = {}, None, None, []
    def flush():
        if title and cols and rows:
            out[title] = pd.DataFrame(rows, columns=["ym"] + cols).set_index("ym")
    for line in open(path, encoding="latin-1"):
        s = line.rstrip("\n").strip()
        if not s:
            continue
        if s.startswith(","):
            cols = [c.strip() for c in s.split(",")[1:]]; rows = []; continue
        parts = [p.strip() for p in s.split(",")]
        if len(parts[0]) == 6 and parts[0].isdigit() and cols:
            vals = [float(p) for p in parts[1:len(cols) + 1]]
            rows.append([parts[0]] + [np.nan if v <= -99.99 else v / 100 for v in vals]); continue
        if not parts[0].isdigit():
            flush(); title, cols, rows = s.strip(), None, []
    flush()
    return out


def ann(r):
    r = r.dropna()
    return float((1 + r).prod() ** (12 / len(r)) - 1) if len(r) else None


def tstat(r):
    r = r.dropna()
    return float(r.mean() / (r.std(ddof=1) / math.sqrt(len(r)))) if len(r) > 2 else None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--data", required=True); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    base = os.path.join(a.data, "french", "csv")
    periods = {"1963-2026": ("196307", "202609"), "1963-2006": ("196307", "200612"), "2007-2016": ("200701", "201610"),
               "2016-2026 (backtest)": ("201611", "202609"), "2016-2020": ("201611", "202010"), "2020-2026": ("202011", "202609")}
    res = {"factors": {}, "sorts": {}}
    ff = sections(os.path.join(base, "F-F_Research_Data_5_Factors_2x3.csv"))
    fm = [v for k, v in ff.items() if "Annual" not in k][0]
    mom = [v for k, v in sections(os.path.join(base, "F-F_Momentum_Factor.csv")).items() if "Annual" not in k][0]
    fm = fm.join(mom.rename(columns={mom.columns[0]: "Mom"}), how="left")
    for f in ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "Mom"]:
        res["factors"][f] = {p: {"ann": ann(fm[f].loc[s:e]), "t": tstat(fm[f].loc[s:e])} for p, (s, e) in periods.items()}
    sorts = {"E/P (bénéfice / cours)": ("Portfolios_Formed_on_E-P.csv", "Hi 30", "Lo 30"),
             "B/M (valeur comptable / cours)": ("Portfolios_Formed_on_BE-ME.csv", "Hi 30", "Lo 30"),
             "CF/P (cash-flow / cours)": ("Portfolios_Formed_on_CF-P.csv", "Hi 30", "Lo 30"),
             "D/P (rendement du dividende)": ("Portfolios_Formed_on_D-P.csv", "Hi 30", "Lo 30"),
             "OP (rentabilité opérationnelle)": ("Portfolios_Formed_on_OP.csv", "Hi 30", "Lo 30"),
             "INV (croissance des actifs)": ("Portfolios_Formed_on_INV.csv", "Lo 30", "Hi 30"),
             "NI (émissions nettes d'actions)": ("Portfolios_Formed_on_NI.csv", "< 0", "Hi 20"),
             "AC (accruals)": ("Portfolios_Formed_on_AC.csv", "Lo 20", "Hi 20")}
    for name, (fname, good, bad) in sorts.items():
        sec = sections(os.path.join(base, fname))
        out = {}
        for wkey, label in [("Value Weight", "vw"), ("Equal Weight", "ew")]:
            df = next((v for k, v in sec.items() if wkey in k and "Monthly" in k), None)
            if df is None or good not in df or bad not in df: continue
            spread = df[good] - df[bad]
            out[label] = {p: {"good": ann(df[good].loc[s:e]), "bad": ann(df[bad].loc[s:e]), "spread_ann": float(spread.loc[s:e].mean() * 12),
                              "t": tstat(spread.loc[s:e])} for p, (s, e) in periods.items()}
            if "<= 0" in df: out[label + "_nonpositive"] = {p: ann(df["<= 0"].loc[s:e]) for p, (s, e) in periods.items()}
            if "Zero" in df: out[label + "_zero"] = {p: ann(df["Zero"].loc[s:e]) for p, (s, e) in periods.items()}
        res["sorts"][name] = {"good": good, "bad": bad, **out}
    json.dump(res, open(a.out, "w"), indent=1)
    pf = lambda v: "  n.d." if v is None else f"{v*100:6.1f}%"
    print("Facteur          " + "".join(f"{p:>22s}" for p in periods))
    for f, v in res["factors"].items():
        print(f"{f:16s}" + "".join(f"{pf(v[p]['ann'])} (t={v[p]['t']:5.2f})" for p in periods))
    for name, v in res["sorts"].items():
        for w in ["vw", "ew"]:
            if w in v:
                print(f"{name[:30]:30s} {w}: " + " | ".join(f"{p}: {pf(v[w][p]['spread_ann'])} t={v[w][p]['t']:.1f}" for p in periods))


if __name__ == "__main__":
    main()
