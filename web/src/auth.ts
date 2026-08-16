import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import type { Session } from "next-auth";
import type { Provider } from "next-auth/providers";
import Nodemailer from "next-auth/providers/nodemailer";

import type { AuthEnvironment } from "@/auth/env";
import { loadAuthEnvironment } from "@/auth/env";
import { getDatabase } from "@/db";

import * as schema from "./db/schema";

function recordSignInEvent(database: GatewayDatabase, userId?: string | null): void {
  if (!userId) {
    return;
  }
  void database
    .insert(schema.auditEvents)
    .values({
      actorUserId: userId,
      eventType: "sign_in",
      metadata: {},
    })
    .catch(() => undefined);
}

export const authEnvironment = loadAuthEnvironment(process.env);

export type GatewayDatabase = NodePgDatabase<typeof schema>;

export function buildAuthConfig(
  environment: AuthEnvironment,
  database: GatewayDatabase,
) {
  const providers: Provider[] = [];
  if (environment.github !== undefined) {
    providers.push(
      GitHub({
        clientId: environment.github.clientId,
        clientSecret: environment.github.clientSecret,
      }),
    );
  }
  if (environment.email !== undefined) {
    providers.push(
      Nodemailer({
        server: environment.email.server,
        from: environment.email.from,
      }),
    );
  }

  return NextAuth({
    adapter: DrizzleAdapter(database),
    providers,
    session: { strategy: "database" },
    secret: environment.secret,
    trustHost: environment.trustHost,
    pages: { signIn: "/login" },
    events: {
      signIn: ({ user }) => {
        recordSignInEvent(database, user?.id);
      },
    },
  });
}

export type AuthInstance = ReturnType<typeof buildAuthConfig>;

let cachedAuthInstance: AuthInstance | null = null;

function getAuthInstance(): AuthInstance {
  if (cachedAuthInstance === null) {
    cachedAuthInstance = buildAuthConfig(authEnvironment, getDatabase().db);
  }
  return cachedAuthInstance;
}

export function auth(): Promise<Session | null> {
  return getAuthInstance().auth() as Promise<Session | null>;
}

export function signIn(
  ...args: Parameters<AuthInstance["signIn"]>
): ReturnType<AuthInstance["signIn"]> {
  return getAuthInstance().signIn(...args);
}

export function signOut(
  ...args: Parameters<AuthInstance["signOut"]>
): ReturnType<AuthInstance["signOut"]> {
  return getAuthInstance().signOut(...args);
}

export const authHandlers = {
  GET: (...args: Parameters<AuthInstance["handlers"]["GET"]>) =>
    getAuthInstance().handlers.GET(...args),
  POST: (...args: Parameters<AuthInstance["handlers"]["POST"]>) =>
    getAuthInstance().handlers.POST(...args),
};