"""Construit, pour une ou plusieurs dates de formation F, les données d'entrée du moteur
(lib/scoring.ts) telles qu'elles étaient connues à la date F (« point-in-time »).

Sources :
  - SEC EDGAR XBRL (data.sec.gov companyfacts) : comptes annuels publiés, avec date de dépôt.
    Seuls les chiffres déposés au plus tard à la date F sont retenus (pas de biais d'anticipation) ;
    pour un même exercice, la version la plus récente déposée avant F est utilisée (comme Yahoo).
  - defeatbeta/yahoo-finance-data (Hugging Face, licence ODC-BY) : cours ajustés des splits et
    scissions, dividendes, événements de split, secteur/industrie Yahoo, taux du Trésor US.

Les champs produits reprennent les noms Yahoo attendus par le moteur (totalRevenue, EBITDA,
netIncome, trailingPE, dividendYield…), afin que le backtest exécute exactement le code de l'app.

Usage : python3 -I build_snapshots.py --data DIR --out snapshots.jsonl --dates 2016-10-31 [...]
"""
import argparse, gzip, json, math, os, re, sys
from datetime import date, timedelta

import numpy as np
import pandas as pd

D = lambda s: date.fromisoformat(s[:10])

# ---------------------------------------------------------------- concepts XBRL (ordre de préférence)
REVENUE = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet",
           "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueGoodsNet", "SalesRevenueServicesNet",
           "RevenuesNetOfInterestExpense", "RegulatedAndUnregulatedOperatingRevenue", "ElectricUtilityRevenue",
           "RealEstateRevenueNet", "OperatingLeasesIncomeStatementLeaseRevenue", "OilAndGasRevenue",
           "FinancialServicesRevenue", "TotalRevenuesAndOtherIncome", "RevenuesExcludingInterestAndDividends", "PremiumsEarnedNet"]
NI_COMMON = ["NetIncomeLossAvailableToCommonStockholdersBasic", "NetIncomeLoss", "ProfitLoss",
             "NetIncomeLossAvailableToCommonStockholdersDiluted", "IncomeLossFromContinuingOperations"]
NI_TOTAL = ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"]
OPINC = ["OperatingIncomeLoss"]
PRETAX = ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
          "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
          "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"]
DA = ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization",
      "DepreciationAmortizationAndOther"]
DEPR, AMORT = ["Depreciation"], ["AmortizationOfIntangibleAssets"]
INTEREST = ["InterestExpense", "InterestExpenseDebt", "InterestAndDebtExpense", "InterestExpenseNonoperating",
            "InterestExpenseBorrowings"]
EPS_D = ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"]
EPS_B = ["EarningsPerShareBasic", "EarningsPerShareBasicAndDiluted"]
GROSS = ["GrossProfit"]
COGS = ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices",
        "CostOfGoodsSoldExcludingDepreciationDepletionAndAmortization", "CostOfGoodsAndServicesSoldExcludingDepreciationDepletionAndAmortization"]
OCF = ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]
CAPEX = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForCapitalImprovements",
         "PaymentsToAcquireOtherPropertyPlantAndEquipment", "PaymentsToAcquireOilAndGasPropertyAndEquipment",
         "PaymentsToAcquireOilAndGasProperty", "PaymentsToDevelopRealEstateAssets", "PaymentsForConstructionInProcess",
         "PaymentsToAcquireAndDevelopRealEstate", "PaymentsToAcquireMiningAssets"]
DIV_PAID = ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends", "PaymentsOfOrdinaryDividends", "DividendsCommonStockCash",
            "DividendsCommonStock"]
DILUTED_SH = ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"]
BANK_NII, BANK_NONII = ["InterestIncomeExpenseNet", "InterestIncomeExpenseAfterProvisionForLoanLoss"], ["NoninterestIncome"]
# bilan (instantanés)
ASSETS, LIAB, LIAB_EQ = ["Assets"], ["Liabilities"], ["LiabilitiesAndStockholdersEquity"]
EQUITY = ["StockholdersEquity"]
EQUITY_TOT = ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]
CA, CL, RE = ["AssetsCurrent"], ["LiabilitiesCurrent"], ["RetainedEarningsAccumulatedDeficit"]
CASH = ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash",
        "CashAndDueFromBanks", "CashEquivalentsAtCarryingValue", "CashAndCashEquivalentsAtCarryingValueIncludingDiscontinuedOperations",
        "CashCashEquivalentsAndFederalFundsSold"]
STI = ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesCurrent",
       "AvailableForSaleSecuritiesDebtSecuritiesCurrent", "HeldToMaturitySecuritiesCurrent", "TradingSecuritiesCurrent",
       "OtherShortTermInvestments"]
CASH_STI = ["CashCashEquivalentsAndShortTermInvestments"]
DEBT_TOTAL = ["DebtAndCapitalLeaseObligations", "DebtLongtermAndShorttermCombinedAmount"]
LTD_TOTAL = ["LongTermDebt"]
LTD_NONCUR = ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermNotesPayable", "SeniorLongTermNotes",
              "LongTermLoansPayable", "OtherLongTermDebtNoncurrent", "ConvertibleNotesPayable", "LongTermLineOfCredit"]
LTD_CUR = ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"]
DEBT_CUR = ["DebtCurrent"]
STB = ["ShortTermBorrowings", "CommercialPaper", "LinesOfCreditCurrent", "NotesPayableCurrent", "ShortTermBankLoansAndNotesPayable"]
DEBT_PARTS = ["SeniorNotes", "NotesPayable", "SecuredDebt", "UnsecuredDebt", "LineOfCredit", "OtherBorrowings", "SubordinatedDebt"]
SHARES_BS = ["CommonStockSharesOutstanding"]

DURATION_TAGS = sorted(set(REVENUE + NI_COMMON + NI_TOTAL + OPINC + PRETAX + DA + DEPR + AMORT + INTEREST + EPS_D + EPS_B + GROSS + COGS
                           + OCF + CAPEX + DIV_PAID + DILUTED_SH + BANK_NII + BANK_NONII))
INSTANT_TAGS = sorted(set(ASSETS + LIAB + LIAB_EQ + EQUITY + EQUITY_TOT + CA + CL + RE + CASH + STI + CASH_STI + DEBT_TOTAL
                          + LTD_TOTAL + LTD_NONCUR + LTD_CUR + DEBT_CUR + STB + DEBT_PARTS + SHARES_BS))
FYE_TAGS = REVENUE + ["NetIncomeLoss", "OperatingIncomeLoss", "NetCashProvidedByUsedInOperatingActivities", "ProfitLoss"]


DOMESTIC_FORMS = ("10-K", "10-K/A", "10-KT", "10-KT/A", "10-K405", "10-Q", "10-Q/A", "8-K", "8-K/A")
ANNUAL_FORMS = ("10-K", "10-K/A", "10-KT", "10-KT/A", "10-K405", "8-K", "8-K/A")  # les 10-Q contiennent parfois des cumuls 12 mois


class Facts:
    """Faits XBRL d'une société, indexés pour une extraction « point-in-time »."""

    def __init__(self, cf):
        self.name = cf.get("entityName", "")
        g = cf.get("facts", {}).get("us-gaap", {})
        self.dur, self.inst = {}, {}
        self.currencies = set()
        for tag in DURATION_TAGS:
            for unit, arr in g.get(tag, {}).get("units", {}).items():
                if not (unit == "USD" or unit == "USD/shares" or unit == "shares"):
                    if unit.isalpha() and len(unit) == 3: self.currencies.add(unit)
                    continue
                rows = []
                for f in arr:
                    if "start" not in f or f.get("form") not in ANNUAL_FORMS: continue
                    s, e = D(f["start"]), D(f["end"])
                    if 350 <= (e - s).days <= 380:
                        rows.append((e, D(f["filed"]), float(f["val"]), f.get("form", "").startswith("10-K")))
                if rows: self.dur[tag] = rows
        for tag in INSTANT_TAGS:
            for unit, arr in g.get(tag, {}).get("units", {}).items():
                if unit not in ("USD", "shares"):
                    if unit.isalpha() and len(unit) == 3: self.currencies.add(unit)
                    continue
                rows = [(D(f["end"]), D(f["filed"]), float(f["val"])) for f in arr if "start" not in f and f.get("form") in DOMESTIC_FORMS]
                if rows: self.inst[tag] = rows
        dei = cf.get("facts", {}).get("dei", {})
        self.dei_shares = []  # (end, filed, accn, val)
        for unit, arr in dei.get("EntityCommonStockSharesOutstanding", {}).get("units", {}).items():
            for f in arr:
                self.dei_shares.append((D(f["end"]), D(f["filed"]), f.get("accn", ""), float(f["val"])))
        self.dei_float = [(D(f["end"]), D(f["filed"]), float(f["val"]))
                          for arr in dei.get("EntityPublicFloat", {}).get("units", {}).values() for f in arr]

    def float_at(self, F, max_age=550):
        cand = [r for r in self.dei_float if r[1] <= F and (F - r[0]).days <= max_age]
        return max(cand, key=lambda r: (r[1], r[0]))[2] if cand else None

    def fyes(self, F):
        """Dates de clôture des exercices annuels publiés au plus tard à F (dédoublonnées)."""
        ends = set()
        for tag in FYE_TAGS:
            for e, filed, _, is10k in self.dur.get(tag, []):
                if is10k and filed <= F and e <= F: ends.add(e)
        out = []
        for e in sorted(ends):
            if out and (e - out[-1]).days <= 20: out[-1] = e
            else: out.append(e)
        return out

    def _pick(self, table, tag, fye, F, tol=10):
        best = None
        for e, filed, v, *_ in table.get(tag, []):
            if filed <= F and abs((e - fye).days) <= tol:
                if best is None or filed > best[0] or (filed == best[0] and abs((e - fye).days) < best[2]):
                    best = (filed, v, abs((e - fye).days))
        return None if best is None else best[1]

    def dval(self, tags, fye, F):
        for t in tags:
            v = self._pick(self.dur, t, fye, F)
            if v is not None: return v
        return None

    def ival(self, tags, fye, F):
        for t in tags:
            v = self._pick(self.inst, t, fye, F)
            if v is not None: return v
        return None

    def consistent_dval(self, tags, fyes, F):
        """Série cohérente : on privilégie le concept présent sur le plus d'exercices (évite les ruptures
        de série quand une société change de concept, ex. SalesRevenueNet -> Revenues)."""
        cover = []
        for i, t in enumerate(tags):
            vals = [self._pick(self.dur, t, e, F) for e in fyes]
            cover.append((sum(v is not None for v in vals), -i, vals))
        cover.sort(reverse=True)
        best = cover[0][2] if cover else [None] * len(fyes)
        out = list(best)
        for k, e in enumerate(fyes):
            if out[k] is None: out[k] = self.dval(tags, e, F)
        return out

    def shares_at(self, F, max_age=400):
        """Nombre d'actions (page de garde) le plus récent déposé avant F ; somme des catégories d'actions."""
        cand = [r for r in self.dei_shares if r[1] <= F and (F - r[0]).days <= max_age]
        if not cand: return None
        last_filed = max(r[1] for r in cand)
        cur = [r for r in cand if r[1] == last_filed]
        last_end = max(r[0] for r in cur)
        vals = sorted({r[3] for r in cur if r[0] == last_end})
        return float(sum(vals)) if vals else None


def nz(v):
    return v if v is not None and math.isfinite(v) else None


def build_rows(fx: Facts, F):
    fyes = [e for e in fx.fyes(F) if e <= F][-6:]
    if not fyes: return [], None
    rev = fx.consistent_dval(REVENUE, fyes, F)
    rows = []
    for k, e in enumerate(fyes):
        r = {"date": e.isoformat()}
        revenue = rev[k]
        if revenue is None:  # banques : produit net d'intérêts + autres produits
            nii, nonii = fx.dval(BANK_NII, e, F), fx.dval(BANK_NONII, e, F)
            if nii is not None: revenue = nii + (nonii or 0.0)
        r["totalRevenue"] = revenue
        ni_c, ni_t = fx.dval(NI_COMMON, e, F), fx.dval(NI_TOTAL, e, F)
        r["netIncomeCommonStockholders"], r["netIncome"] = ni_c, ni_t if ni_t is not None else ni_c
        opi, pretax, intr = fx.dval(OPINC, e, F), fx.dval(PRETAX, e, F), fx.dval(INTEREST, e, F)
        r["operatingIncome"] = opi
        r["interestExpense"] = intr
        ebit = (pretax + intr) if (pretax is not None and intr is not None) else opi
        if ebit is None and pretax is not None: ebit = pretax  # intérêts non publiés : approximation prudente
        r["EBIT"] = ebit
        da = fx.dval(DA, e, F)
        if da is None:
            dp, am = fx.dval(DEPR, e, F), fx.dval(AMORT, e, F)
            if dp is not None: da = dp + (am or 0.0)
        r["EBITDA"] = (ebit + da) if (ebit is not None and da is not None) else None
        r["dilutedEPS"], r["basicEPS"] = fx.dval(EPS_D, e, F), fx.dval(EPS_B, e, F)
        gp = fx.dval(GROSS, e, F)
        if gp is None and revenue is not None:
            cogs = fx.dval(COGS, e, F)
            if cogs is not None: gp = revenue - cogs
        r["grossProfit"] = gp
        ocf = fx.dval(OCF, e, F)
        capex = fx.dval(CAPEX, e, F)
        r["operatingCashFlow"] = ocf
        r["capitalExpenditure"] = -abs(capex) if capex is not None else None
        r["freeCashFlow"] = (ocf - abs(capex)) if (ocf is not None and capex is not None) else None
        r["dividendsPaid"] = fx.dval(DIV_PAID, e, F)
        r["dilutedAverageShares"] = fx.dval(DILUTED_SH, e, F)
        # bilan
        ta, tl = fx.ival(ASSETS, e, F), fx.ival(LIAB, e, F)
        eq, eq_tot = fx.ival(EQUITY, e, F), fx.ival(EQUITY_TOT, e, F)
        if tl is None:
            le = fx.ival(LIAB_EQ, e, F)
            if le is not None and (eq_tot is not None or eq is not None): tl = le - (eq_tot if eq_tot is not None else eq)
        r["totalAssets"], r["totalLiabilitiesNetMinorityInterest"] = ta, tl
        r["commonStockEquity"] = eq
        r["stockholdersEquity"] = eq_tot if eq_tot is not None else eq
        ca, cl = fx.ival(CA, e, F), fx.ival(CL, e, F)
        r["currentAssets"], r["currentLiabilities"] = ca, cl
        r["workingCapital"] = (ca - cl) if (ca is not None and cl is not None) else None
        r["retainedEarnings"] = fx.ival(RE, e, F)
        cash = fx.ival(CASH, e, F)
        csti = fx.ival(CASH_STI, e, F)
        if csti is None and cash is not None:
            sti = fx.ival(STI, e, F)
            csti = cash + (sti or 0.0)
        r["cashAndCashEquivalents"], r["cashCashEquivalentsAndShortTermInvestments"] = cash, csti
        tot = fx.ival(DEBT_TOTAL, e, F)
        ltd_tot, ltd_nc = fx.ival(LTD_TOTAL, e, F), fx.ival(LTD_NONCUR, e, F)
        ltd_c, debt_c, stb = fx.ival(LTD_CUR, e, F), fx.ival(DEBT_CUR, e, F), fx.ival(STB, e, F)
        if tot is None:
            if ltd_tot is not None: tot = ltd_tot + (stb or 0.0)
            elif ltd_nc is not None or debt_c is not None or ltd_c is not None or stb is not None:
                tot = (ltd_nc or 0.0) + (debt_c if debt_c is not None else (ltd_c or 0.0) + (stb or 0.0))
        if tot is None:
            parts = [fx.ival([t], e, F) for t in DEBT_PARTS]
            if any(v is not None for v in parts): tot = sum(v for v in parts if v is not None)
        r["totalDebt"] = tot  # None = aucune dette déclarée (le moteur la considère alors comme nulle, comme Yahoo)
        r["debtReported"] = tot is not None
        if ltd_nc is not None: r["longTermDebt"] = ltd_nc
        elif ltd_tot is not None: r["longTermDebt"] = ltd_tot - (ltd_c or 0.0)
        else: r["longTermDebt"] = None
        shb, dil = fx.ival(SHARES_BS, e, F), r["dilutedAverageShares"]
        r["ordinarySharesNumber"] = shb if (shb and (not dil or 0.6 <= shb / dil <= 1.6)) else (dil or None)
        rows.append({k: (nz(v) if isinstance(v, float) else v) for k, v in r.items()})
    for k, r in enumerate(rows):
        r["debtCarried"] = False
        if r["totalDebt"] is None and (r.get("interestExpense") or 0) > 0:
            prev = next((rows[j] for j in range(k - 1, max(-1, k - 3), -1) if rows[j].get("debtReported")), None)
            if prev is not None:
                r["totalDebt"], r["debtCarried"] = prev["totalDebt"], True
                if r.get("longTermDebt") is None: r["longTermDebt"] = prev.get("longTermDebt")
    rows = [r for r in rows if r.get("totalRevenue") is not None][-5:]
    return rows, (fyes[-1] if fyes else None)


# ---------------------------------------------------------------- marché (defeatbeta)
def split_ratio(s):
    a, b = s.split(":")
    return float(a) / float(b)


def is_true_split(s):
    """Vrai split (2:1, 3:2, 1:8…) par opposition à un ajustement de scission enregistré comme split (1281:1000)."""
    a, b = (float(x) for x in s.split(":"))
    if a.is_integer() and b.is_integer():
        g = math.gcd(int(a), int(b))
        return max(int(a) // g, int(b) // g) <= 25
    x = max(a / b, b / a)
    return x <= 25 and abs(x * 2 - round(x * 2)) < 0.02


# Sociétés dont l'action a survécu mais dont le CIK historique a été renommé (rapprochement par nom impossible).
# Vérifiés à la main : cours au 31/10/2016 de la série Yahoo = cours de l'ancienne entité.
CIK_ALIASES = {1001039: "DIS",   # TWDC Enterprises 18 Corp. = ancienne Walt Disney Co (holding recréée en 2019)
               1441634: "AVGO",  # Avago Technologies (dernier 10-K avant F ; Broadcom Ltd n'en a déposé qu'en déc. 2016)
               884905: "LIN",    # Praxair (l'historique Yahoo de LIN avant 2018 est celui de Praxair)
               29915: "DD",      # Dow Chemical (l'historique Yahoo de DD avant 2017 est celui de Dow Chemical)
               1364742: "BLK"}   # BlackRock Finance, Inc. = ancienne BlackRock, Inc. (holding recréée en 2024)


def load_market(data):
    H = os.path.join(data, "hf_defeatbeta")
    px = pd.read_parquet(f"{H}/stock_prices.parquet", columns=["symbol", "report_date", "close"])
    px["close"] = px.close.astype(float)
    px["report_date"] = pd.to_datetime(px.report_date)
    dv = pd.read_parquet(f"{H}/stock_dividend_events.parquet")
    dv["amount"] = dv.amount.astype(float); dv["report_date"] = pd.to_datetime(dv.report_date)
    sp = pd.read_parquet(f"{H}/stock_split_events.parquet")
    sp["ratio"] = sp.split_factor.map(split_ratio); sp["report_date"] = pd.to_datetime(sp.report_date)
    sp["spin"] = ~sp.split_factor.map(is_true_split)
    prof = pd.read_parquet(f"{H}/stock_profile.parquet", columns=["symbol", "sector", "industry", "country"])
    tk = pd.DataFrame(json.load(open(f"{H}/company_tickers.json")).values())
    ty = pd.read_parquet(f"{H}/daily_treasury_yield.parquet", columns=["report_date", "bc_10year"])
    ty["report_date"] = pd.to_datetime(ty.report_date); ty["bc_10year"] = ty.bc_10year.astype(float)
    so = pd.read_parquet(f"{H}/stock_shares_outstanding.parquet")
    so["report_date"] = pd.to_datetime(so.report_date)
    return px, dv, sp, prof, tk, ty, so


_SUFFIX = re.compile(r"\b(inc|incorporated|corp|corporation|co|company|companies|ltd|limited|plc|holdings?|group|the|sa|nv|ag|se|lp|llc|de|del|new|n v|s a)\b")


def norm_name(n):
    n = re.sub(r"/[a-z]{2,3}/", " ", (n or "").lower())
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    return re.sub(r"\s+", "", _SUFFIX.sub(" ", n))


def classify_exit(path, F):
    """Motif de disparition d'après les dépôts SEC postérieurs à F : faillite (8-K item 1.03), rachat/fusion
    (circulaire de fusion, offre publique, 8-K item 2.01) ou autre ; et date de retrait de la cote (Form 25/15)."""
    out = {"exit": "unknown", "exitDate": None, "delistedBeforeF": False}
    if not os.path.exists(path) or os.path.getsize(path) == 0: return out
    try:
        rec = json.load(gzip.open(path))["filings"]["recent"]
    except Exception:
        return out
    forms, dates, items = rec.get("form", []), rec.get("filingDate", []), rec.get("items", [""] * len(rec.get("form", [])))
    Fi = F.isoformat()
    dereg = sorted(d for f, d in zip(forms, dates) if f in ("25", "25-NSE", "15-12B", "15-12G", "15-15D"))
    before = [d for d in dereg if d < Fi]; after = [d for d in dereg if d >= Fi]
    last10k = max((d for f, d in zip(forms, dates) if f.startswith("10-K") or f.startswith("10-Q")), default=None)
    if before and not (last10k and last10k > before[-1]): out["delistedBeforeF"] = True
    post = [(f, d, it or "") for f, d, it in zip(forms, dates, items) if d >= Fi]
    bk = [d for f, d, it in post if f.startswith("8-K") and "1.03" in it]
    mg = [d for f, d, it in post if f in ("DEFM14A", "PREM14A", "SC 14D9", "SC TO-T", "DEFM14C", "PREM14C") or (f.startswith("8-K") and "2.01" in it and "1.03" not in it)]
    out["exitDate"] = after[0] if after else (max(dates) if dates else None)
    out["exit"] = "bankruptcy" if bk else ("merger" if mg else ("other" if after else "unknown"))
    return out


def sic_profile(sic):
    """Secteur/industrie au format Yahoo déduits du code SIC (sociétés disparues, sans profil Yahoo)."""
    if sic is None: return "", ""
    s = int(sic)
    if s == 6798: return "Real Estate", "REIT - Diversified"
    if 6000 <= s <= 6199: return "Financial Services", "Banks - Regional"
    if 6200 <= s <= 6299: return "Financial Services", "Capital Markets"
    if 6300 <= s <= 6411: return "Financial Services", "Insurance - Diversified"
    if 6500 <= s <= 6599: return "Real Estate", "Real Estate Services"
    if 6700 <= s <= 6799: return "Financial Services", "Asset Management"
    if 4900 <= s <= 4999: return "Utilities", "Utilities - Diversified"
    if 1300 <= s <= 1399 or 2900 <= s <= 2999: return "Energy", "Oil & Gas"
    if 2830 <= s <= 2836 or 8000 <= s <= 8099 or 3840 <= s <= 3851: return "Healthcare", "Healthcare"
    if 3570 <= s <= 3579 or 3670 <= s <= 3679 or 7370 <= s <= 7379: return "Technology", "Technology"
    if 4800 <= s <= 4899: return "Communication Services", "Telecom Services"
    if 5000 <= s <= 5999: return "Consumer Cyclical", "Retail"
    if 1000 <= s <= 1499 or 2600 <= s <= 2899 or 3300 <= s <= 3399: return "Basic Materials", "Materials"
    return "Industrials", "Industrials"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dates", nargs="+", required=True)
    ap.add_argument("--min-mcap", type=float, default=1e8)
    ap.add_argument("--gone", default=None, help="fichier de CIK disparus (analyse du biais de survie, sans cours)")
    args = ap.parse_args()
    Fs = [D(s) for s in args.dates]
    px, dv, sp, prof, tk, ty, so = load_market(args.data)
    so_by = {k: g.sort_values("report_date") for k, g in so.groupby("symbol")}
    prof = prof.set_index("symbol")
    tk["cik"] = tk.cik_str.astype("Int64")
    # prix à chaque date F (dernier cours connu dans les 7 jours précédents)
    snap_px = {}
    for F in Fs:
        lo = pd.Timestamp(F) - pd.Timedelta(days=7)
        w = px[(px.report_date > lo) & (px.report_date <= pd.Timestamp(F))].sort_values("report_date").groupby("symbol").tail(1)
        snap_px[F] = w.set_index("symbol").close.to_dict()
    cand = tk[tk.ticker.isin(set().union(*[set(v) for v in snap_px.values()]))].copy()
    bad = re.compile(r"(?:-P[A-Z]?|-WS?|-UN?|-RT?|\.W|\.U)$")
    cand = cand[~cand.ticker.str.contains(bad)]
    cand = cand[cand.ticker.isin(prof.index) & prof.reindex(cand.ticker).sector.notna().values]
    cand = cand[cand.cik.notna()].copy(); cand["cik"] = cand.cik.astype(int)
    by_cik = cand.groupby("cik").ticker.apply(list).to_dict()
    divs = {s: g for s, g in dv.groupby("symbol")}
    splits = {s: g for s, g in sp.groupby("symbol")}
    gone = set()
    if args.gone and os.path.exists(args.gone):
        gone = {int(x) for x in open(args.gone).read().split()}
    subs_dir = os.path.join(args.data, "sec", "submissions")
    cf_dir = os.path.join(args.data, "sec", "companyfacts")
    n_out = 0
    stats = {}
    title = dict(zip(tk.ticker, tk.title))
    gone |= set(CIK_ALIASES)
    order = [c for c in sorted(by_cik) if c not in gone] + sorted(c for c in gone if c not in by_cik)
    unmatched = {F: {} for F in Fs}   # nom normalisé -> ticker coté à F sans comptes rattachés à son CIK actuel
    def bump(k): stats[k] = stats.get(k, 0) + 1
    with open(args.out, "w") as out:
        for cik in order:
            path = f"{cf_dir}/CIK{int(cik):010d}.json.gz"
            tickers = by_cik.get(cik, [])
            is_gone = cik not in by_cik
            fx = None
            if os.path.exists(path) and os.path.getsize(path) > 0:
                try: fx = Facts(json.load(gzip.open(path)))
                except Exception: bump("bad_json")
            for F in Fs:
                try:
                    rows, last_fye = build_rows(fx, F) if fx else ([], None)
                except (ZeroDivisionError, ValueError, TypeError) as e:
                    bump("error"); rows, last_fye = [], None
                ok = len(rows) >= 2 and last_fye is not None and (F - last_fye).days <= 548
                sym, relinked = None, False
                if not is_gone:
                    sym = next((t for t in tickers if t in snap_px[F]), None)
                    if sym is None: continue
                    if not ok:
                        unmatched[F].setdefault(norm_name(title.get(sym, "")), sym); bump("no_rows"); continue
                else:
                    if not ok: continue
                    nn = norm_name(fx.name)
                    alias = CIK_ALIASES.get(int(cik))
                    # égalité stricte des noms normalisés (un préfixe commun produit de faux appariements : ENB, FUN…)
                    hit = alias if (alias and alias in snap_px[F] and alias in unmatched[F].values()) else (unmatched[F].get(nn) if nn else None)
                    if hit:
                        sym, relinked = hit, True
                        unmatched[F] = {k: t for k, t in unmatched[F].items() if t != hit}
                        bump("relinked")
                    elif F != Fs[0]:
                        continue  # analyse du biais de survie : uniquement à la première date
                if fx.currencies - {"USD"} and not any(r.get("totalRevenue") for r in rows):
                    bump("fx"); continue
                shares = fx.shares_at(F)
                pfloat = fx.float_at(F)
                rec = {"cik": int(cik), "asOf": F.isoformat(), "name": fx.name, "rows": rows, "relinked": relinked}
                if sym:
                    p_adj = snap_px[F][sym]
                    s_after = splits.get(sym)
                    fac = float(np.prod(s_after[s_after.report_date > pd.Timestamp(F)].ratio)) if s_after is not None else 1.0
                    price = p_adj * fac
                    mc_sec = price * shares if shares else None
                    spin = float(np.prod(s_after[(s_after.report_date > pd.Timestamp(F)) & s_after.spin].ratio)) if s_after is not None else 1.0
                    g_so = so_by.get(sym)
                    mc_alt = None
                    if g_so is not None:
                        w = g_so[(g_so.report_date <= pd.Timestamp(F)) & (g_so.report_date > pd.Timestamp(F) - pd.Timedelta(days=200))]
                        if len(w): mc_alt = p_adj * float(w.shares_outstanding.iloc[-1]) * spin
                    fl = pfloat if (pfloat and (mc_alt is None or pfloat > 0.02 * mc_alt)) else None  # flottant aberrant ignoré
                    near = lambda m: m is not None and fl is not None and 0.3 * fl <= m <= 5 * fl
                    dist = lambda m: abs(math.log(m / fl)) if (m and fl) else 99.0
                    mcap, src = None, None
                    if mc_sec and mc_alt and 1 / 1.5 <= mc_sec / mc_alt <= 1.5:
                        mcap, src = mc_sec, "sec"                       # deux sources indépendantes concordantes
                    elif mc_sec and mc_alt and fl:
                        best = min((mc_sec, "sec"), (mc_alt, "ycharts"), key=lambda t: dist(t[0]))
                        if near(best[0]): mcap, src = best             # désaccord : le flottant SEC tranche
                    elif (mc_sec or mc_alt) and not (mc_sec and mc_alt):
                        only = (mc_sec, "sec") if mc_sec else (mc_alt, "ycharts")
                        if near(only[0]) or fl is None: mcap, src = only
                    if mcap is not None:
                        L0 = rows[-1]; rev0, ni0 = L0.get("totalRevenue") or 0, L0.get("netIncomeCommonStockholders") or 0
                        if (rev0 > 0 and mcap / rev0 > 60) or (ni0 > 0 and mcap / ni0 > 800) or mcap > 3e12:
                            mcap, src = None, None                     # valeur implausible
                    if mcap is None:
                        bump("no_mcap"); continue
                    if src == "ycharts":
                        bump("mcap_ycharts"); shares = mcap / price
                    pr = prof.loc[sym]
                    txt = lambda v: v if isinstance(v, str) else ""   # NaN pandas -> chaîne vide (JSON valide)
                    sector, industry, country = txt(pr.sector), txt(pr.industry), txt(pr.country)
                    if industry == "Shell Companies": bump("shell"); continue
                    dd = divs.get(sym)
                    dlist = [] if dd is None else [{"date": d.strftime("%Y-%m-%d"), "amount": a}
                                                   for d, a in zip(dd.report_date, dd.amount) if d <= pd.Timestamp(F)]
                    ttm = sum(x["amount"] for x in dlist if D(x["date"]) > F - timedelta(days=365))
                    rec.update({"symbol": sym, "priceAdj": p_adj, "splitFactorAfter": fac, "price": price, "marketCap": mcap, "mcapSource": src,
                                "sector": sector, "industry": industry, "country": country, "dividends": dlist,
                                "ttmDividendAdj": ttm, "dividendYield": (ttm / p_adj) if p_adj else None})
                    if mcap < args.min_mcap: bump("small"); continue
                else:
                    sic = None
                    sp_path = f"{subs_dir}/CIK{int(cik):010d}.json.gz"
                    if os.path.exists(sp_path) and os.path.getsize(sp_path) > 0:
                        try: sic = json.load(gzip.open(sp_path)).get("sic") or None
                        except Exception: sic = None
                    sector, industry = sic_profile(sic)
                    rec.update(classify_exit(sp_path, F))
                    rec.update({"symbol": None, "gone": True, "sic": sic, "sector": sector, "industry": industry, "country": "United States",
                                "price": None, "marketCap": None, "dividends": [], "dividendYield": None})
                rec["sharesOutstanding"] = shares
                rec["publicFloat"] = pfloat
                yy = ty[ty.report_date <= pd.Timestamp(F)].tail(1)
                rec["riskFreePct"] = float(yy.bc_10year.iloc[0]) * 100 if len(yy) else None
                out.write(json.dumps(rec, allow_nan=False) + "\n"); n_out += 1; bump("ok_gone" if rec.get("gone") else "ok")
    print("snapshots écrits :", n_out, stats, file=sys.stderr)


if __name__ == "__main__":
    main()
