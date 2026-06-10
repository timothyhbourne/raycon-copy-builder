export function ingestDesignsSystemPrompt(): string {
  return `You are looking at an image of an approved Raycon email marketing campaign. Your job is to read all the copy in the image and produce a structured representation. The image contains the final designed email; you only care about the text content and the structural breakdown.`;
}

export function ingestDesignsUserPrompt(productSlugsCsv: string): string {
  return `Read this email and extract all copy. Return JSON with:

- title: a short descriptive title (your invention is fine if no obvious title)
- date: ISO date if visible, else null
- campaign_type: one of [promo, launch, restock, story, seasonal, winback, newsletter], best guess
- offer: string description of the offer
- promo_code: string or null (look for "USE CODE: ..." or similar)
- hero_angle: short string describing the angle
- audience: best guess, default "all"
- products_featured: array of product slugs inferred from the copy (match against: ${productSlugsCsv})
- conceit: "[FILL ME IN]"
- body: the campaign content as markdown. Use \`# ElementName\` headings for each visible block. Group transcribed copy by visual section: Subject Line (if shown), Preview Text (if shown), Headline, Tagline, Body, CTA, Feature Pills (if present), Product Names (if grid), etc. Transcribe text verbatim. Where you see only an image with no text, write \`[image only]\`.

Return only valid JSON.`;
}
