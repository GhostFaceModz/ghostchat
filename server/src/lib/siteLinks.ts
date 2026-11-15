/** Hostnames that count as "this site" for same-tab widget links (apex and www). */
export function siteHostsFrom(url?: string | null, customDomain?: string | null): string[] {
  const hosts = new Set<string>();
  for (const raw of [url, customDomain]) {
    if (!raw) continue;
    try {
      const href = /https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      const host = new URL(href).hostname.toLowerCase();
      const apex = host.replace(/^www\./, "");
      if (apex) {
        hosts.add(apex);
        hosts.add(`www.${apex}`);
      }
    } catch { /* ignore bad urls */ }
  }
  return [...hosts];
}

export function openSiteLinksMode(value: unknown): "same_tab" | "new_tab" {
  return value === "new_tab" ? "new_tab" : "same_tab";
}
