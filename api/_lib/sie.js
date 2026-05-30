// api/_lib/sie.js — minimal SIE4 parser. Reads #VER / #TRANS blocks from a .se file
// and returns the same payload shape as Qopla's createSIEFileByDate, so the existing
// buildVouchersFromSie() can turn it into Fortnox vouchers.
//
// Handles the dinkassa export format, e.g.:
//   #VER "A" "1" 20260529 "Dagsavslut" 20260529
//   {
//      #TRANS 3002 {} -3062.68
//      #TRANS 1580 {"1" "AVD1"} 3430.20
//   }
// SIE #TRANS amount sign: positive = debit, negative = credit (same as Qopla).

function fmtDate(d) {
  return d && d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "";
}

function parseTrans(line) {
  // #TRANS <account> {<dim>} <amount> [transdate] [text] [quantity]
  const m = line.match(/^#TRANS\s+(\d+)\s+\{([^}]*)\}\s+(-?[\d.,]+)/);
  if (!m) return null;
  const account = m[1];
  const dim = m[2] || "";
  const amount = parseFloat(m[3].replace(",", "."));
  if (!isFinite(amount)) return null;
  // cost center = dimension 1 object code, if present: {"1" "AVD1"}
  const cc = dim.match(/"1"\s+"([^"]+)"/);
  return { sieAccountNumber: account, amount, costCenter: cc ? cc[1] : null };
}

export function parseSie4(text) {
  const lines = String(text).split(/\r?\n/);
  const verifications = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#VER")) {
      const dateM = line.match(/(\d{8})/);
      const quotes = [...line.matchAll(/"([^"]*)"/g)].map(x => x[1]);
      // #VER "serie" "nr" date "text" date  → text is the 3rd quoted token if present
      const name = quotes[2] || quotes[quotes.length - 1] || "Verifikation";
      cur = { date: fmtDate(dateM ? dateM[1] : ""), name, sieTransactions: [] };
    } else if (line === "{") {
      // begin block for cur
    } else if (line.startsWith("}")) {
      if (cur && cur.sieTransactions.length) verifications.push(cur);
      cur = null;
    } else if (line.startsWith("#TRANS") && cur) {
      const t = parseTrans(line);
      if (t) cur.sieTransactions.push(t);
    }
  }
  // flush a trailing verification with no closing brace
  if (cur && cur.sieTransactions.length) verifications.push(cur);
  return { verifications, referenceReportId: null };
}
