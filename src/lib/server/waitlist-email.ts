// Immutable content is persisted with the first send attempt for safe retries.
export function waitlistEmail(from: string, email: string) {
  return {
    from,
    to: [email],
    subject: "You're on the Orbsie Plus waitlist ✨",
    text: "You're on the Orbsie Plus waitlist.\n\nThanks for being part of Orbsie. We've saved your place on the list, and we'll email you when there's news about Plus.\n\nIn the meantime, there's a little universe waiting for your next idea. Keep creating at https://orbsie.com\n\nThis confirms your waitlist signup; it isn't a purchase or a subscription. If you didn't request this, you can ignore this email.\n\nOrbsie · A world from an idea",
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome to the Orbsie Plus waitlist</title></head><body style="margin:0;padding:0;background:#070b18;color:#edfaff;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your next little universe is just an idea away. You're on the list.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#070b18;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;border:1px solid #24354b;border-radius:24px;background:#10192a;overflow:hidden;">
<tr><td align="center" style="padding:40px 28px 12px;color:#bcecf3;font-size:24px;font-weight:700;letter-spacing:-1px;">orbsie<span style="color:#75e2ec;">.</span></td></tr>
<tr><td align="center" style="padding:18px 24px 30px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" width="100" height="100" style="width:100px;height:100px;border-radius:50%;background:#77dce5;background:radial-gradient(circle at 30% 25%,#dcffff 0%,#72dce6 35%,#287f99 70%,#17304f 100%);box-shadow:0 0 54px #195165;color:#12334a;font-size:36px;">✦</td></tr></table></td></tr>
<tr><td style="padding:0 36px 38px;text-align:center;"><p style="margin:0 0 16px;color:#83e4ee;font-size:11px;letter-spacing:3px;font-weight:700;">ORBSIE PLUS · WAITLIST</p><h1 style="margin:0 0 20px;font-size:36px;line-height:1.15;letter-spacing:-1px;color:#f3fcff;">A little more<br>possibility.</h1><p style="margin:0 0 14px;font-size:17px;line-height:1.6;color:#d6e3ed;">You're on the list.</p><p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#aebed0;">Thanks for being part of Orbsie. We've saved your place on the Plus waitlist, and we'll email you when there's news to share.</p>
<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td style="border-radius:100px;background:#8ce5ec;"><a href="https://orbsie.com" style="display:inline-block;padding:16px 28px;color:#102938;text-decoration:none;font-size:14px;font-weight:700;">Keep creating &nbsp;↗</a></td></tr></table><p style="margin:28px 0 0;font-size:13px;line-height:1.7;color:#8fa7bd;">Your next little universe<br>is just an idea away.</p></td></tr>
<tr><td style="padding:24px 32px;border-top:1px solid #24354b;text-align:center;font-size:11px;line-height:1.8;color:#91a4ba;">This confirms your waitlist signup. It isn't a purchase or a subscription.<br>If you didn't request this, you can ignore this email.</td></tr></table>
<p style="margin:24px 0 0;font-size:11px;letter-spacing:1px;color:#788fa9;">ORBSIE &nbsp;·&nbsp; A WORLD FROM AN IDEA</p></td></tr></table></body></html>`,
  };
}
export type ConfirmationEmail = ReturnType<typeof waitlistEmail>;
