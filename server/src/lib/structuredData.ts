/** Pull product and FAQ structured data from HTML, Shopify, and WooCommerce feeds. */
import * as cheerio from "cheerio";
import { assertPublicHttpUrl, sameOrigin } from "./ssrf.js";

export type StructuredPage = { url: string; title: string; text: string };

const UA = "GhostChatBot/1.0 (+https://github.com/GhostFaceModz/ghostchat)";

export type ProductRecord = {
  title: string;
  url?: string | null;
  description?: string;
  price?: string | null;
  currency?: string | null;
  availability?: string | null;
  variants?: string[];
};

function money(price: unknown, currency?: unknown): string | null {
  if (price == null || price === "") return null;
  const cur = currency ? String(currency).toUpperCase() : "";
  const n = typeof price === "number" ? price : String(price).replace(/[^0-9.]/g, "");
  if (!n) return String(price);
  return cur ? `${cur} ${n}` : String(n);
}

function stockLabel(v?: string | null): string {
  if (!v) return "";
  const s = v.replace(/([a-z])([A-Z])/g, "$1 $2");
  if (/in\s*stock/i.test(s) && !/out/i.test(s)) return "in stock";
  if (/out\s*of\s*stock|sold\s*out/i.test(s)) return "out of stock";
  return s;
}

function productText(p: ProductRecord): string {
  const bits = [`Product: ${p.title}`];
  if (p.price) bits.push(`Price: ${p.price}`);
  if (p.availability) bits.push(`Stock: ${stockLabel(p.availability)}`);
  if (p.variants?.length) bits.push(`Variants: ${p.variants.slice(0, 20).join(", ")}`);
  if (p.description) bits.push(p.description.slice(0, 1200));
  if (p.url) bits.push(`URL: ${p.url}`);
  return bits.join("\n");
}

export function productsToPages(products: ProductRecord[], fallbackOrigin: string): StructuredPage[] {
  return products.filter((p) => p.title).slice(0, 400).map((p) => ({
    url: p.url || fallbackOrigin,
    title: p.title,
    text: productText(p),
  }));
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v == null ? [] : [v];
}

function collectGraph(node: unknown, out: unknown[]): void {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach((n) => collectGraph(n, out)); return; }
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    out.push(o);
    if (o["@graph"]) collectGraph(o["@graph"], out);
  }
}

export function extractJsonLd(html: string, pageUrl: string): { products: ProductRecord[]; faqs: Array<{ question: string; answer: string; url: string }> } {
  const $ = cheerio.load(html);
  const products: ProductRecord[] = [];
  const faqs: Array<{ question: string; answer: string; url: string }> = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      const nodes: unknown[] = [];
      collectGraph(parsed, nodes);
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const o = node as Record<string, unknown>;
        const types = asArray(o["@type"]).map((t) => String(t).toLowerCase());
        if (types.some((t) => t === "product" || t.endsWith("product"))) {
          const offers = asArray(o.offers) as Record<string, unknown>[];
          const offer = offers[0] || {};
          const variants = asArray(o.hasVariant).concat(asArray(o.model)).map((v) => {
            if (v && typeof v === "object" && "name" in (v as object)) return String((v as { name: unknown }).name);
            return String(v);
          }).filter(Boolean);
          products.push({
            title: String(o.name || "Product"),
            url: String(o.url || pageUrl),
            description: String(o.description || ""),
            price: money(offer.price ?? o.price, offer.priceCurrency ?? o.priceCurrency),
            currency: offer.priceCurrency ? String(offer.priceCurrency) : null,
            availability: offer.availability ? String(offer.availability).split("/").pop() : null,
            variants,
          });
        }
        if (types.some((t) => t === "faqpage")) {
          for (const ev of asArray(o.mainEntity)) {
            if (!ev || typeof ev !== "object") continue;
            const e = ev as Record<string, unknown>;
            const q = String(e.name || e.question || "");
            const accepted = asArray(e.acceptedAnswer)[0] as Record<string, unknown> | undefined;
            const a = String(accepted?.text || e.answer || "");
            if (q && a) faqs.push({ question: q, answer: a, url: pageUrl });
          }
        }
      }
    } catch {
      /* ignore invalid JSON-LD */
    }
  });
  return { products, faqs };
}

export async function fetchShopifyProducts(origin: URL, max = 250): Promise<ProductRecord[]> {
  const url = new URL("/products.json", origin);
  url.searchParams.set("limit", String(Math.min(max, 250)));
  try {
    await assertPublicHttpUrl(url.href);
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const json = (await res.json()) as { products?: Array<Record<string, unknown>> };
    return (json.products || []).map((p) => {
      const variants = asArray(p.variants) as Record<string, unknown>[];
      const first = variants[0] || {};
      const inStock = variants.some((v) => v.available === true || Number(v.inventory_quantity) > 0);
      return {
        title: String(p.title || "Product"),
        url: p.handle ? new URL(`/products/${p.handle}`, origin).href : origin.href,
        description: String(p.body_html || p.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        price: money(first.price, first.currency || "GBP"),
        availability: inStock ? "InStock" : "OutOfStock",
        variants: variants.map((v) => String(v.title || v.sku || "")).filter((t) => t && t !== "Default Title"),
      };
    });
  } catch {
    return [];
  }
}

export async function fetchWooProducts(origin: URL, max = 100): Promise<ProductRecord[]> {
  const url = new URL("/wp-json/wc/store/v1/products", origin);
  url.searchParams.set("per_page", String(Math.min(max, 100)));
  try {
    await assertPublicHttpUrl(url.href);
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) return [];
    return json.map((p: Record<string, unknown>) => {
      const prices = (p.prices || {}) as Record<string, unknown>;
      const currency = prices.currency_code || prices.currency_prefix;
      const amount = prices.price ?? prices.regular_price;
      const display = typeof amount === "string" && amount.length > 2 && !String(amount).includes(".")
        ? (Number(amount) / 100).toFixed(2)
        : amount;
      return {
        title: String(p.name || "Product"),
        url: String(p.permalink || origin.href),
        description: String(p.short_description || p.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        price: money(display, currency),
        availability: p.is_in_stock === false ? "OutOfStock" : "InStock",
        variants: asArray((p as { variations?: unknown }).variations).map((v) => String(v)).filter(Boolean),
      };
    });
  } catch {
    return [];
  }
}

export async function discoverStructuredPages(origin: URL, maxProducts: number): Promise<StructuredPage[]> {
  const [shopify, woo] = await Promise.all([
    fetchShopifyProducts(origin, maxProducts),
    fetchWooProducts(origin, maxProducts),
  ]);
  const all = [...shopify, ...woo].slice(0, maxProducts);
  return productsToPages(all, origin.href).filter((p) => sameOrigin(origin, p.url));
}

export const JS_RENDER_SKIPPED =
  "JavaScript rendering is skipped on the free Render plan: Chromium does not fit in the 512MB RAM cap. A hosted browser such as Browserless starts at about $25/month.";
