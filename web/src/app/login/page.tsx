import type { Metadata } from "next";

import { authEnvironment } from "@/auth";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Passwordless seller sign-in for the AgentPay hosted GET gateway.",
};

// Auth providers are runtime-only secrets and must never be captured in the build output.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const github = authEnvironment.github !== undefined;
  const email = authEnvironment.email !== undefined;

  return (
    <main className="login-page">
      <LoginForm github={github} email={email} />
    </main>
  );
}
