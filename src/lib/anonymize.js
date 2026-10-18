// Replacing the configured domain in collected text.

export const REPLACEMENT_DOMAIN = "example.com";

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Replaces the domain and its subdomains ("mail.company.ru" ->
// "mail.example.com"), but not longer names ending the same way
// ("mycompany.ru"). Case-insensitive. Empty domain leaves text as is.
export function replaceDomain(text, domain) {
  if (!domain) return text;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}-])${escapeRegExp(domain)}(?![\\p{L}\\p{N}-])`, "giu");
  return text.replace(pattern, REPLACEMENT_DOMAIN);
}
