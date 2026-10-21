import React from "react";
import { Button, Link, Text } from "@react-email/components";
import { Code, Layout, colors, heading, note, paragraph } from "./layout";

/**
 * Supabase fills these placeholders itself when it sends the email:
 *   {{ .Token }}           the 6-digit code
 *   {{ .ConfirmationURL }} the one-click link
 *   {{ .Email }}           the address the email goes to
 */
const CODE = "{{ .Token }}";
const LINK = "{{ .ConfirmationURL }}";

function LinkButton({ children }: { children: string }) {
  return (
    <Button
      href={LINK}
      style={{ backgroundColor: colors.primary, color: "#fff", fontSize: 15, fontWeight: 600, padding: "12px 22px", borderRadius: 10 }}
    >
      {children}
    </Button>
  );
}

export function ConfirmSignup() {
  return (
    <Layout preview={`Your Kayyro verification code is ${CODE}`}>
      <Text style={heading}>Verify your email</Text>
      <Text style={paragraph}>Welcome to Kayyro! Enter this code to finish creating your account:</Text>
      <Code>{CODE}</Code>
      <Text style={paragraph}>Or just tap the button:</Text>
      <LinkButton>Verify my email</LinkButton>
      <Text style={note}>The code and link expire in 1 hour. Never share this code with anyone.</Text>
    </Layout>
  );
}

/** Sent when an existing user signs in with an emailed code (Supabase "Magic Link" template). */
export function SignInCode() {
  return (
    <Layout preview={`Your Kayyro sign-in code is ${CODE}`}>
      <Text style={heading}>Your sign-in code</Text>
      <Text style={paragraph}>Enter this code on the Kayyro sign-in page:</Text>
      <Code>{CODE}</Code>
      <Text style={paragraph}>Or sign in with one tap:</Text>
      <LinkButton>Sign in to Kayyro</LinkButton>
      <Text style={note}>
        The code expires in 1 hour. Kayyro will never ask you for this code by phone or chat.
      </Text>
    </Layout>
  );
}

export function ResetPassword() {
  return (
    <Layout preview="Reset your Kayyro password">
      <Text style={heading}>Reset your password</Text>
      <Text style={paragraph}>
        We received a request to reset the password for your Kayyro account. Tap the button to choose a new
        one:
      </Text>
      <LinkButton>Choose a new password</LinkButton>
      <Text style={note}>
        If you didn&apos;t ask for this, your password is unchanged and you can ignore this email. The link
        expires in 1 hour.
      </Text>
    </Layout>
  );
}

export function ChangeEmail() {
  return (
    <Layout preview="Confirm your new email address">
      <Text style={heading}>Confirm your new email</Text>
      <Text style={paragraph}>Confirm that this is the new email address for your Kayyro account:</Text>
      <LinkButton>Confirm new email</LinkButton>
      <Text style={note}>
        Didn&apos;t request this? Sign in and change your password, then contact{" "}
        <Link href="mailto:support@kayyro.com" style={{ color: colors.primary }}>
          support@kayyro.com
        </Link>
        .
      </Text>
    </Layout>
  );
}

export function Reauthentication() {
  return (
    <Layout preview={`Your Kayyro security code is ${CODE}`}>
      <Text style={heading}>Confirm it&apos;s you</Text>
      <Text style={paragraph}>Enter this code to confirm the change you are making:</Text>
      <Code>{CODE}</Code>
      <Text style={note}>If you didn&apos;t request this, change your password right away.</Text>
    </Layout>
  );
}
