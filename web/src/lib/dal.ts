import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { redirect } from "next/navigation";

import * as schema from "@/db/schema";

export type GatewayDatabase =
  | NodePgDatabase<typeof schema>
  | PgliteDatabase<typeof schema>;

export interface Seller {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
}

export type SessionLike = {
  readonly user?: { readonly id?: string | null } | null;
} | null;

export function sellerIdFromSession(session: SessionLike): string | null {
  const id = session?.user?.id;
  if (typeof id !== "string" || id.trim() === "") {
    return null;
  }
  return id;
}

export async function getSeller(
  database: GatewayDatabase,
  userId: string,
): Promise<Seller | null> {
  const rows = await database
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
  };
}

export async function requireSeller(
  database: GatewayDatabase,
  session: SessionLike,
): Promise<Seller> {
  const userId = sellerIdFromSession(session);
  if (userId === null) {
    redirect("/login");
  }
  const seller = await getSeller(database, userId);
  if (seller === null) {
    redirect("/login");
  }
  return seller;
}