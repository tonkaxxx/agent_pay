"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export interface LoginFormOptions {
  readonly github: boolean;
  readonly email: boolean;
}

export function LoginForm({ github, email }: LoginFormOptions) {
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="login-card">
      <h1>Sign in to AgentPay</h1>
      <p className="login-sub">Passwordless seller access to the hosted GET gateway.</p>

      <div className="login-providers">
        {github ? (
          <button
            className="login-provider-button"
            type="button"
            onClick={() => void signIn("github", { redirectTo: "/dashboard" })}
          >
            Continue with GitHub
          </button>
        ) : null}
        {email ? (
          <form
            action={async (formData) => {
              setSubmitted(true);
              const emailValue = formData.get("email");
              if (typeof emailValue !== "string" || emailValue.trim() === "") {
                setSubmitted(false);
                return;
              }
              await signIn("nodemailer", { email: emailValue.trim(), redirectTo: "/dashboard" });
            }}
          >
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
            <button className="login-provider-button" type="submit" disabled={submitted}>
              {submitted ? "Sent — check your inbox" : "Email me a sign-in link"}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
