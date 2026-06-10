export function ingestDocSystemPrompt(): string {
  return `You are processing a master document containing many past Raycon email campaigns concatenated together without explicit separators. Your job is to identify each individual campaign, extract its content verbatim, and produce structured metadata for it.

A campaign typically starts with a date heading (e.g. "4/9/2026 - E25 Flash Sale 5% Engaged Buyers Test - 30% Off [EM11]") or a campaign title heading. It contains labelled elements like Subject Line, Preview Text, Headline, Tagline, Hero Image Direction, Body Copy, CTA, USPs, etc.

If a section of text does not look like a campaign (e.g. it's a brief, a meeting note, a fragment), skip it.`;
}

export function ingestDocUserPrompt(chunkText: string, productSlugsCsv: string): string {
  return `Master document chunk:
<<<
${chunkText}
>>>

Identify every distinct campaign in this chunk. For each, return a JSON object with:

- title: string (from the heading or inferred)
- date: ISO date if extractable, else null
- campaign_type: one of [promo, launch, restock, story, seasonal, winback, newsletter], best guess
- offer: string description of the offer, e.g. "30% off Everyday Earbuds Classic"
- promo_code: string or null
- hero_angle: short string describing the angle
- audience: one of [all, engaged, lapsed, post_purchase, vip], best guess
- products_featured: array of product slugs you can infer from the copy (match against this product list: ${productSlugsCsv})
- conceit: leave as "[FILL ME IN]"
- body: the campaign content as markdown. Use \`# ElementName\` headings for each labelled element (Headline, Tagline, Body Copy, etc.). Preserve the original element names from the source.

Return JSON: { "campaigns": [ ... ] }

Return only valid JSON, no preamble. If the chunk contains no campaigns, return { "campaigns": [] }.`;
}
