import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import type { Provider } from "next-auth/providers";
import Nodemailer from "next-auth/providers/nodemailer";

import type { AuthEnvironment } from "@/auth/env";
import { loadAuthEnvironment } from "@/auth/env";
import { getDatabase } from "@/db";

import type * as schema from "./db/schema";

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
  });
}

const database = getDatabase();
const authInstance = buildAuthConfig(authEnvironment, database.db);

export const { handlers: authHandlers, auth, signIn, signOut } = authInstance;