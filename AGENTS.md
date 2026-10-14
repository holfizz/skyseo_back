# SkySEO Telegram outreach

- Never put a full website domain or URL in an automated or prepared Telegram message to a lead, including competitor names, first messages, follow-ups, and prepared manual replies.
- Use only the main domain name without the suffix: `example.ru` → `example`, `shop.example.co.uk` → `example`. Do not include `https://`, `www.`, `.ru`, `.com`, or other domain zones.
- Check the final rendered message, including values already stored in `leadVars`, before sending. Keep the send-time guard that rejects remaining links; do not weaken it to make a template pass.

Manual conversation exception: URLs and full domains are allowed in messages typed by the operator only after a confirmed outgoing message in that conversation. The first outgoing message, including a manual one, must still reject links. Keep automated templates and prepared replies without domain suffixes.

# Client SEO presentations

- For a website review or client presentation, follow `docs/presentation/CLIENT_PRESENTATION_PLAYBOOK.md`. Reuse the approved shared style and the single verified before/after case. Use the common preparation pipeline through `npm run prepare:call` or the CRM preparation queue; do not create per-client copies of hardcoded SKB-4 generators. The playbook defines evidence requirements and the shared CRM/PDF speaking script.
