/** Downloadable WordPress / Shopify installers. Not app-store listings. */
export const SHOPIFY_SNIPPET = `{% comment %}
  GhostChat widget snippet.
  1. Upload this file as a snippet named "ghostchat".
  2. In layout/theme.liquid, just before </body>, add: {% render 'ghostchat' %}
  3. Replace YOUR_SITE_KEY with the site key from your GhostChat dashboard Setup tab, unless this file was downloaded for a specific site.
  This file is a theme snippet only — it is not a Shopify App Store listing.
{% endcomment %}
<script src="https://ghostchat.pro/widget.js" data-id="YOUR_SITE_KEY" async></script>
`;

export function shopifySnippet(siteKey: string): string {
  const key = String(siteKey || "").trim();
  if (!/^gc_[A-Za-z0-9_-]+$/.test(key) || key.startsWith("gc_stg_")) return SHOPIFY_SNIPPET;
  return SHOPIFY_SNIPPET.replace('data-id="YOUR_SITE_KEY"', 'data-id="' + key + '"');
}
