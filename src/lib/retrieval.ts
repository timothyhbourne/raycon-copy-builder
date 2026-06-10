import type { ExpandedBrief, LibraryCampaign } from "./schemas";

export function retrieveExamples(brief: ExpandedBrief, library: LibraryCampaign[], n = 8): LibraryCampaign[] {
  const scored = library.map((campaign) => {
    let score = 0;
    if (campaign.campaign_type === brief.campaign_type) score += 3;
    if (campaign.audience === brief.audience) score += 2;
    if (campaign.products_featured.some((p) => brief.products_featured.includes(p))) score += 2;
    const ageYears = (Date.now() - new Date(campaign.date).getTime()) / (365 * 24 * 60 * 60 * 1000);
    score += Math.max(0, 2 - ageYears * 0.4);
    return { campaign, score };
  });

  const sorted = scored.sort((a, b) => b.score - a.score);
  const aboveThreshold = sorted.filter((x) => x.score > 0);

  if (aboveThreshold.length < 3) {
    // fall back to top 5 by recency
    return library
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
  }

  return sorted.slice(0, n).map((x) => x.campaign);
}
