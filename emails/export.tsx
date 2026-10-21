import React from "react";
/**
 * Turns each Kayyro email into plain HTML for Supabase (Authentication > Emails > Templates).
 * Run: npm run emails:export  -> files appear in emails/dist
 */
import { render } from "@react-email/render";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ChangeEmail, ConfirmSignup, Reauthentication, ResetPassword, SignInCode } from "./auth-emails";

const outDir = join(__dirname, "dist");
mkdirSync(outDir, { recursive: true });

const files: [string, () => React.ReactElement][] = [
  ["confirm-signup", () => <ConfirmSignup />],
  ["magic-link-sign-in-code", () => <SignInCode />],
  ["reset-password", () => <ResetPassword />],
  ["change-email", () => <ChangeEmail />],
  ["reauthentication", () => <Reauthentication />],
];

async function main() {
  for (const [name, el] of files) {
    writeFileSync(join(outDir, `${name}.html`), await render(el()));
    console.log(`emails/dist/${name}.html`);
  }
}
void main();
