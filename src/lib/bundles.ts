import { getProductName } from "./products";

/**
 * Pre-built Raycon bundles offered on the storefront, for the `bundle` section's
 * "existing" mode. `products` are catalogue SKU ids (see lib/products).
 *
 * PROVENANCE: seeded from rayconglobal.com on 2026-07-28. Raycon's bundle
 * collections are seasonal and were largely EMPTY at seed time — the Shopify
 * feed showed only the Open Summer Bundle live (verified via its variant
 * options: Essential Open Earbuds + Bone Conduction Headphones, $179.96). The
 * All-Star Bundle came from search (product page 404'd at seed time, so its
 * contents/price are best-effort and marked unverified). Keep this list in sync
 * as Raycon rotates bundles — it is a plain hand-maintained catalogue.
 */
export interface RayconBundle {
  id: string;
  name: string;
  /** Shopify storefront handle, if known. */
  handle?: string;
  /** Catalogue SKU ids included in the bundle. */
  products: string[];
  /** Bundle price in USD, if known. */
  price?: number;
  /** false when the contents/price could not be verified live at seed time. */
  verified?: boolean;
}

export const RAYCON_BUNDLES: RayconBundle[] = [
  {
    id: "open-summer",
    name: "Open Summer Bundle",
    handle: "open-summer-bundle",
    products: ["O15", "B42"],
    price: 179.96,
    verified: true,
  },
  {
    id: "all-star",
    name: "The All-Star Bundle",
    handle: "the-all-star-bundle",
    products: ["E45", "E25"],
    price: 192.91,
    verified: false,
  },
];

const BUNDLE_BY_ID: Record<string, RayconBundle> = Object.fromEntries(
  RAYCON_BUNDLES.map((b) => [b.id, b]),
);

export function getBundle(id: string | undefined): RayconBundle | undefined {
  return id ? BUNDLE_BY_ID[id] : undefined;
}

/** Human-readable contents, e.g. "Essential Open Earbuds + Bone Conduction Headphones". */
export function bundleContentsLabel(b: RayconBundle): string {
  return b.products.map(getProductName).join(" + ");
}
