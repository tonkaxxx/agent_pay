import type { Metadata } from "next";
import Link from "next/link";

import { EndpointForm } from "@/components/dashboard/endpoint-form";
import styles from "@/components/dashboard/dashboard.module.css";
import { createEndpointAction } from "@/features/gateway/actions";

export const metadata: Metadata = {
  title: "New endpoint",
  description: "Create a hosted GET gateway endpoint.",
};

export default function NewEndpointPage() {
  return (
    <main className={styles.dashboard}>
      <div className={styles.heading}>
        <div>
          <h1>New endpoint</h1>
          <p className={styles.sub}>Turn any HTTPS GET API into a paid x402 v2 endpoint.</p>
        </div>
      </div>
      <EndpointForm mode="create" existingSecret={false} armed action={createEndpointAction} />
      <p className={styles.hint}>
        <Link href="/dashboard">Cancel</Link>
      </p>
    </main>
  );
}