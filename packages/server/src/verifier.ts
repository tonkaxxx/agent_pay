import {
  type Address,
  type Hash,
  type Hex,
  decodeEventLog,
  getAddress,
  isAddressEqual,
  parseAbi,
  parseUnits,
} from "viem";

const usdcAddresses: Record<SupportedChainId, Address> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

const transferAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const usdcPricePattern = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

export type SupportedChainId = 8453 | 84532;

export interface PaymentRequirements {
  priceUsdc: string;
  payTo: Address;
  chainId: SupportedChainId;
}

export interface ReceiptClient {
  getTransactionReceipt(args: { hash: Hash }): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[];
  }>;
  getBlockNumber(): Promise<bigint>;
}

export interface ReplayStore {
  claim(key: string): boolean | Promise<boolean>;
}

export class InMemoryReplayStore implements ReplayStore {
  readonly #claimed = new Set<string>();

  claim(key: string): boolean {
    if (this.#claimed.has(key)) return false;
    this.#claimed.add(key);
    return true;
  }
}

/** Temporary open union; Task 2 supplies the public closed set of reasons. */
export type PaymentFailureReason = string;

export type PaymentVerificationResult =
  | { valid: true }
  | { valid: false; reason: PaymentFailureReason; retryable: boolean };

export type PaymentVerifier = (txHash: string) => Promise<PaymentVerificationResult>;

export interface CreatePaymentVerifierOptions {
  requirements: PaymentRequirements;
  publicClient: ReceiptClient;
  replayStore?: ReplayStore;
}

export function getUsdcAddress(chainId: SupportedChainId): Address {
  return usdcAddresses[chainId];
}

export function createPaymentVerifier({
  requirements,
  publicClient,
}: CreatePaymentVerifierOptions): PaymentVerifier {
  if (!usdcPricePattern.test(requirements.priceUsdc)) {
    throw new Error("priceUsdc must be a USDC amount with at most six decimal places");
  }

  const requiredAmount = parseUnits(requirements.priceUsdc, 6);
  if (requiredAmount <= 0n) {
    throw new Error("priceUsdc must be greater than zero");
  }

  const payTo = getAddress(requirements.payTo);
  const usdcAddress = getUsdcAddress(requirements.chainId);

  return async (txHash) => {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hash });
    if (receipt.status !== "success") {
      return { valid: false, reason: "transaction_reverted", retryable: false };
    }

    let paid = 0n;
    for (const log of receipt.logs) {
      if (!isAddressEqual(log.address, usdcAddress)) continue;
      try {
        const decoded = decodeEventLog({
          abi: transferAbi,
          topics: log.topics as [Hex, ...Hex[]],
          data: log.data,
        });
        if (isAddressEqual(decoded.args.to, payTo)) paid += decoded.args.value;
      } catch {
        continue;
      }
    }

    return paid >= requiredAmount
      ? { valid: true }
      : { valid: false, reason: "insufficient_payment", retryable: false };
  };
}
