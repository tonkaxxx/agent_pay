export interface ReconcileInput {
  requestId: string;
  endpointId: string;
  txHash: string;
}

export interface ReconcileReceipt {
  payerAddress: string;
  amountAtomic: string;
}

export interface ReconcileDependencies {
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  verifyReceipt(request: {
    txHash: string;
    payTo: string;
    amountAtomic: string;
  }): Promise<ReconcileReceipt>;
}

export interface ReconcileResult {
  status: "recorded" | "already_recorded" | "endpoint_not_found" | "amount_mismatch";
}

export function commissionAtomic(amountAtomic: string): string;
export function parseReconcileArgs(args: readonly string[]): ReconcileInput;
export function reconcilePayment(
  input: ReconcileInput,
  dependencies: ReconcileDependencies,
): Promise<ReconcileResult>;
export function verifyBaseReceipt(
  rpcUrl: string,
  request: { txHash: string; payTo: string; amountAtomic: string },
): Promise<ReconcileReceipt>;
export function reconcileCli(args: readonly string[]): Promise<ReconcileResult>;