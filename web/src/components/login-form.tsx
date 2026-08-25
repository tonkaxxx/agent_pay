"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

export interface LoginFormOptions {
  readonly github: boolean;
  readonly email: boolean;
}

export function LoginForm({ github, email }: LoginFormOptions) {
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="login-layout">
      <section className="login-brand-panel" aria-label="AgentPay seller onboarding">
        <div className="login-brand-watermark" aria-hidden="true">402</div>
        <div className="login-brand-wordmark">
          <span className="login-brand-mark" aria-hidden="true">A</span>
          <span>AgentPay</span>
        </div>

        <div className="login-brand-copy">
          <h1>Turn a GET endpoint into a <em>paid surface.</em></h1>
        </div>

        <ol className="login-steps" aria-label="Seller onboarding steps">
          <li><strong>01</strong><span>Connect</span></li>
          <li><strong>02</strong><span>Configure</span></li>
          <li><strong>03</strong><span>Get paid</span></li>
        </ol>
      </section>

      <section className="login-auth-panel" aria-label="AgentPay seller sign in">
        <div className="login-auth-inner">
          <div className="login-topbar">
            <Link className="login-wordmark" href="/" aria-label="AgentPay home">
              <span className="login-wordmark-mark" aria-hidden="true">A</span>
              <span>AgentPay</span>
            </Link>
            <Link className="login-back-link" href="/">← Back to home</Link>
          </div>

          <div className="login-content">
            <h2 id="login-title">Welcome back, seller.</h2>
            <p className="login-sub">Sign in to manage your paid endpoints and the gateway that powers them.</p>

            <div className="login-providers">
              {github ? (
                <button
                  className="login-provider-button login-provider-button--github"
                  type="button"
                  onClick={() => void signIn("github", { redirectTo: "/dashboard" })}
                >
                  Continue with GitHub
                </button>
              ) : null}
              {github && email ? (
                <div className="login-divider" aria-label="or continue with email">
                  <span />
                  <span>OR</span>
                  <span />
                </div>
              ) : null}
              {email ? (
                <form
                  className="login-email-form"
                  aria-label="Email sign-in"
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
                  <label className="login-label" htmlFor="login-email">Email</label>
                  <input
                    className="login-email-input"
                    id="login-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                  <button className="login-provider-button login-provider-button--email" type="submit" disabled={submitted}>
                    {submitted ? "Sent — check your inbox" : "Email me a sign-in link"}
                  </button>
                </form>
              ) : null}
            </div>

            <p className="login-security-note">Passwordless access <span>·</span> no account password stored</p>
          </div>
        </div>
      </section>
    </div>
  );
}
