import React from "react";
import { Body, Container, Head, Html, Img, Preview, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";

/**
 * Email apps only show images from a public https address. This is the logo file in /public/logo;
 * set EMAIL_LOGO_URL when exporting if your site lives on another domain.
 */
const LOGO_URL = process.env.EMAIL_LOGO_URL || "https://www.kayyro.com/logo/kayyro-full.png";

export const colors = { primary: "#7c1cf0", soft: "#f3e9ff", ink: "#1a1330", slate: "#5b5670", line: "#e7e3ef" };

/** Shared frame for every Kayyro email: wordmark on top, card, footer. */
export function Layout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ margin: 0, padding: "32px 12px", backgroundColor: "#f6f4fa", fontFamily: "Helvetica, Arial, sans-serif" }}>
        <Container style={{ maxWidth: 480, margin: "0 auto" }}>
          <Img src={LOGO_URL} alt="Kayyro" width={150} height={44} style={{ margin: "0 0 16px", display: "block" }} />
          <Section
            style={{ backgroundColor: "#ffffff", border: `1px solid ${colors.line}`, borderRadius: 14, padding: "28px 28px 24px" }}
          >
            {children}
          </Section>
          <Text style={{ margin: "16px 4px 0", fontSize: 12, lineHeight: "18px", color: colors.slate }}>
            Kayyro - smart billing for every business. You are receiving this because someone used this
            email address on Kayyro. If it wasn&apos;t you, you can ignore this message.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const heading = { margin: "0 0 10px", fontSize: 20, fontWeight: 700, color: colors.ink } as const;
export const paragraph = { margin: "0 0 14px", fontSize: 15, lineHeight: "22px", color: colors.slate } as const;
export const note = { margin: "14px 0 0", fontSize: 12, lineHeight: "18px", color: colors.slate } as const;

/** Big boxed code, e.g. the 6-digit sign-in code. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <Section style={{ margin: "6px 0 16px", padding: "14px 0", backgroundColor: colors.soft, borderRadius: 12, textAlign: "center" }}>
      <Text style={{ margin: 0, fontSize: 32, fontWeight: 800, letterSpacing: 10, color: colors.primary }}>{children}</Text>
    </Section>
  );
}
