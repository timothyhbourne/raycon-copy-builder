import { describe, it, expect } from "vitest";
import { classifyReviewUrl, isFetchableUrl } from "./url-tiers";

// The tier classifier and the URL guard are pure — and they are the part that has
// to be right, because everything downstream fetches whatever they allow.
describe("isFetchableUrl", () => {
  it("accepts a plain https URL", () => {
    expect(isFetchableUrl("https://example.com/reviews").ok).toBe(true);
  });

  it("rejects http, so a review can't be read over a tamperable channel", () => {
    const r = isFetchableUrl("http://example.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/https/i);
  });

  it("rejects private and loopback hosts (SSRF)", () => {
    for (const u of [
      "https://localhost/x", "https://127.0.0.1/x", "https://10.1.2.3/x",
      "https://192.168.0.5/x", "https://169.254.169.254/latest/meta-data",
      "https://172.16.0.1/x", "https://172.31.255.1/x", "https://foo.internal/x",
      "https://box.local/x", "https://[::1]/x", "https://0.0.0.0/x",
    ]) {
      expect(isFetchableUrl(u).ok, u).toBe(false);
    }
  });

  it("accepts public IPs that merely look private-adjacent", () => {
    // 172.15 and 172.32 are OUTSIDE the private 172.16-31 block, and 11.x is public.
    for (const u of ["https://172.15.0.1/x", "https://172.32.0.1/x", "https://11.0.0.1/x"]) {
      expect(isFetchableUrl(u).ok, u).toBe(true);
    }
  });

  it("rejects embedded credentials", () => {
    expect(isFetchableUrl("https://user:pass@example.com").ok).toBe(false);
  });

  it("rejects junk", () => {
    expect(isFetchableUrl("not a url").ok).toBe(false);
    expect(isFetchableUrl("").ok).toBe(false);
  });
});

describe("classifyReviewUrl", () => {
  it("resolves our own product page to its SKU", () => {
    const c = classifyReviewUrl("https://rayconglobal.com/products/the-everyday-earbuds");
    expect("error" in c).toBe(false);
    if (!("error" in c)) {
      expect(c.tier).toBe("storefront");
      expect(c.product_id).toBeTruthy();
      expect(c.note).toMatch(/same reviews/i);
    }
  });

  it("treats our storefront's non-product pages as generic", () => {
    const c = classifyReviewUrl("https://rayconglobal.com/blogs/news/whatever");
    if (!("error" in c)) expect(c.tier).toBe("generic");
  });

  it("blocks the walled gardens rather than pretending to scrape them", () => {
    for (const host of ["amazon.com", "www.bestbuy.com", "walmart.com", "reddit.com"]) {
      const c = classifyReviewUrl(`https://${host}/product/123`);
      expect("error" in c).toBe(false);
      if (!("error" in c)) {
        expect(c.tier, host).toBe("blocked");
        expect(c.note).toMatch(/manually/i);
      }
    }
  });

  it("classifies an unknown shop as generic, to be verified verbatim", () => {
    const c = classifyReviewUrl("https://some-shop.example/products/x");
    if (!("error" in c)) {
      expect(c.tier).toBe("generic");
      expect(c.note).toMatch(/verbatim/i);
    }
  });

  it("surfaces the guard's reason instead of a tier for a bad URL", () => {
    expect(classifyReviewUrl("http://example.com")).toHaveProperty("error");
  });
});
