import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { EndpointDetails } from "@/components/dashboard/endpoint-details";
import styles from "@/components/dashboard/dashboard.module.css";
import { getDatabase } from "@/db";
import {
  changePayoutAction,
  changePriceAction,
  replaceCredentialAction,
  setStatusAction,
} from "@/features/gateway/actions";
import { getEndpointForOwner } from "@/features/gateway/repository";
import { hasRecentSignIn } from "@/features/gateway/service";
import { requireSeller } from "@/lib/dal";
import { publicSiteUrl } from "@/app/site-url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Endpoint",
  description: "Endpoint details and settings.",
};

export default async function EndpointDetailPage({
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

  const gatewayUrl = new URL(`/g/${endpoint.publicId}`, publicSiteUrl()).toString();
  const recent = await hasRecentSignIn({ sellerId: seller.id, db: db.db });

  return (
    <main className={styles.dashboard}>
      <div className={styles.heading}>
        <div>
          <h1>{endpoint.displayName}</h1>
          <p className={styles.sub}>
            <Link href="/dashboard">All endpoints</Link>
          </p>
        </div>
      </div>
      <EndpointDetails
        endpoint={endpoint}
        gatewayUrl={gatewayUrl}
        recent={recent}
        statusAction={setStatusAction}
        credentialAction={replaceCredentialAction}
        payoutAction={changePayoutAction}
        priceAction={changePriceAction}
      />
    </main>
  );
}