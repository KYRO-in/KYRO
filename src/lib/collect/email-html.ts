/** Kayyro Collect reminder email: plain, readable HTML in the business's name (right-to-left for Arabic). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function linkify(escaped: string): string {
  return escaped.replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#7c1cf0;text-decoration:underline">$1</a>');
}

export function collectEmailHtml(input: { text: string; business: string; lang: "en" | "ar" }): string {
  const dir = input.lang === "ar" ? "rtl" : "ltr";
  const align = input.lang === "ar" ? "right" : "left";
  const paragraphs = input.text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.6">${linkify(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!doctype html><html lang="${input.lang}" dir="${dir}"><body style="margin:0;background:#f6f4fa;padding:24px 12px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1a1330">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e7e3ef;border-radius:14px">
<tr><td dir="${dir}" style="padding:26px 28px 6px;text-align:${align};font-size:17px;font-weight:700">${escapeHtml(input.business)}</td></tr>
<tr><td dir="${dir}" style="padding:10px 28px 22px;text-align:${align};font-size:15px">${paragraphs}</td></tr>
</table></td></tr></table></body></html>`;
}
