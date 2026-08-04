import { promoCsvUrl } from "./config";

// Fetch the Promotional Calendar tab as CSV. This works only while the sheet
// stays link-viewable. If Google returns HTML (the login/permission page) or a
// non-200, the sheet has lost public access — surface a clear error rather than
// feeding an HTML blob into the CSV parser. The fallback (not implemented here)
// would be the Sheets API with a service-account key.
export async function fetchPromoCsv(): Promise<string> {
  const url = promoCsvUrl();
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/csv,*/*" },
      cache: "no-store",
      redirect: "follow",
    });
  } catch (e) {
    throw new Error(`Promo calendar fetch failed (network): ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    throw new Error(`Promo calendar fetch returned HTTP ${res.status}. The Google Sheet may no longer be link-viewable — re-share it (Anyone with the link: Viewer) or switch to the Sheets API with a service account.`);
  }
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  // A permission/login redirect resolves to an HTML page, not CSV. Detect it by
  // content-type and by the leading markup so we never parse HTML as rows.
  const looksHtml = ct.includes("text/html") || /^\s*<(?:!doctype|html)/i.test(text);
  if (looksHtml) {
    throw new Error("Promo calendar fetch returned HTML, not CSV — the sheet is no longer public. Re-share it (Anyone with the link: Viewer) or switch to the Sheets API with a service account.");
  }
  return text;
}
