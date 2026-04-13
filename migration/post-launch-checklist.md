# Post-launch validation checklist

- Test the highest-priority legacy URLs from `scripts/seo-migration/reference/gsc_priority_urls.csv`, starting with homepage, blog, contact, projects, and the top property URLs.
- Confirm every tested legacy URL returns a single `301` to the expected final destination.
- Confirm priority destinations return `200` after the redirect and do not bounce through an extra locale redirect.
- Re-check all `approved_section_fallback` URLs, because they carry the highest intent mismatch risk even when technically valid.
- Monitor Google Search Console coverage and indexing changes after launch.
- Review GSC pages with clicks/impressions and confirm that priority legacy URLs no longer show redirect or soft-404 problems.
- Review server logs for `404` responses on legacy paths and compare them with `migration/manual-review-hold.csv`.
- Review server logs for repeated hits to old paths that are still missing from the approved map.
- Verify canonical tags on redirected destination pages, especially posts, properties, projects, and contact/about pages.
- Verify `hreflang` / language alternates if they are emitted on the destination pages.
- Re-crawl a sample of old URLs with your preferred crawler to confirm there are no redirect chains.
- Keep the manual-review set out of production until business/SEO signs off the unresolved property mappings.