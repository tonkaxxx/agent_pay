export interface UnpaidContractInput {
  status: number;
  body: unknown;
  paymentRequired: string;
  baseUrl: string;
  payTo: string;
}

export interface VerifiedUnpaidContract {
  resource: string;
  network: "eip155:8453";
  amount: "10000";
  asset: string;
  payTo: string;
}

export function validateImageReference(image: string): string;
export function validateUnpaidContract(input: UnpaidContractInput): VerifiedUnpaidContract;
export function requireNonPlaceholderSecret(value: string): string;
export function assertEncryptionConfiguration(rendered: {
  services?: { web?: { environment?: Record<string, string | undefined> } };
}): void;
export function verifyProduction(args: readonly string[]): Promise<void>;
