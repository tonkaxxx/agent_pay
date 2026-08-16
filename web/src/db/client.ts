import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export interface DbHandle {
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;
  close(): Promise<void>;
}

export function createDbClient(databaseUrl: string): DbHandle {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, { schema });
  return {
    pool,
    db,
    close: () => pool.end(),
  };
}