import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { EndpointList } from "@/components/dashboard/endpoint-list";
import styles from "@/components/dashboard/dashboard.module.css";
import { getDatabase } from "@/db";
import { listEndpointsForOwner } from "@/features/gateway/repository";
import { requireSeller } from "@/lib/dal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your endpoints",
  description: "Manage your hosted GET gateway endpoints.",
};

export default async function DashboardPage() {
  const session = await auth();
  const db = getDatabase();
  const seller = await requireSeller(db.db, session);
  const endpoints = await listEndpointsForOwner(db.db, seller.id);

  return (
    <main className={styles.dashboard}>
      <div className={styles.heading}>
        <div>
          <h1>Your endpoints</h1>
          <p className={styles.sub}>Signed in as {seller.email}</p>
        </div>
        <Link className="button button--primary" href="/dashboard/new">
          New endpoint
        </Link>
      </div>
      <EndpointList endpoints={endpoints} />
    </main>
  );
}