import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { EndpointForm } from "@/components/dashboard/endpoint-form";
import styles from "@/components/dashboard/dashboard.module.css";
import { getDatabase } from "@/db";
import { atomicToUsdc } from "@/features/gateway/endpoint";
import { updateEndpointAction } from "@/features/gateway/actions";
import { getEndpointForOwner } from "@/features/gateway/repository";
import { hasRecentSignIn } from "@/features/gateway/service";
import { requireSeller } from "@/lib/dal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edit endpoint",
  description: "Edit endpoint details.",
};

export default async function EditEndpointPage({
  params,
}: {
  params: Promise<{ endpointId: string }>;
}) {
  const { endpointId } = await params;
  const session = await auth();
  const db = getDatabase();
  const seller = await requireSeller(db.db, session);
  const endpoint = await getEndpointForOwner(db.db, endpointId, seller.id);

  if (endpoint === null) {
    notFound();
  }

  const recent = await hasRecentSignIn({ sellerId: seller.id, db: db.db });

  return (
    <main className={styles.dashboard}>
      <div className={styles.heading}>
        <div>
          <h1>Edit endpoint</h1>
          <p className={styles.sub}>{endpoint.displayName}</p>
        </div>
      </div>
      <EndpointForm
        mode="edit"
        endpointId={endpoint.id}
        initial={{
          displayName: endpoint.displayName,
          upstreamUrl: endpoint.upstreamUrl,
          authMode: endpoint.authMode,
          price: atomicToUsdc(endpoint.amountAtomic),
          payTo: endpoint.payTo,
        }}
        existingSecret={endpoint.secretConfigured}
        armed={endpoint.status !== "active" || recent}
        action={updateEndpointAction}
      />
    </main>
  );
}