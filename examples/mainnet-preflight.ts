import {
  createPublicClient,
  formatEther,
  formatUnits,
  http,
  parseAbi,
  type Address,
} from "viem";
import { base } from "viem/chains";

import { USDC_BASE, type PaymentAuthorizationContext } from "@x402/client";

import { DEMO_PRICE_USDC } from "./demo-config.js";

const BASE_CHAIN_ID = 8453;
const DEMO_AMOUNT_USDC = 10_000n;
const GAS_BUFFER_MULTIPLIER = 2n;

const usdcAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
]);

export interface MainnetPreflightRuntime {
  getChainId(): Promise<number>;
  getEthBalance(address: Address): Promise<bigint>;
  getUsdcBalance(address: Address): Promise<bigint>;
  simulateTransfer(input: { from: Address; to: Address; amount: bigint }): Promise<void>;
  estimateTransferGas(input: { from: Address; to: Address; amount: bigint }): Promise<bigint>;
  estimateUpperFeePerGas(): Promise<bigint>;
}

export class MainnetPreflightError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MainnetPreflightError";
  }
}

export interface MainnetPreflightOptions {
  readonly context: PaymentAuthorizationContext;
  readonly runtime: MainnetPreflightRuntime;
  readonly agentAddress: Address;
  readonly expectedPayTo: Address;
  readonly expectedRequestUrl: string;
  readonly executeRequested: boolean;
  readonly mainnetAllowed: boolean;
  readonly log: (message: string) => void;
}

export async function authorizeMainnetPayment(
  options: MainnetPreflightOptions,
): Promise<boolean> {
  validateStaticPayment(options);

  const rpcChainId = await readPreflightValue(
    "Could not read the Base RPC chain ID.",
    () => options.runtime.getChainId(),
  );
  if (rpcChainId !== BASE_CHAIN_ID) {
    throw new MainnetPreflightError("RPC is not connected to Base Mainnet (chain 8453).");
  }

  const usdcBalance = await readPreflightValue(
    "Could not read the agent USDC balance.",
    () => options.runtime.getUsdcBalance(options.agentAddress),
  );
  if (usdcBalance < DEMO_AMOUNT_USDC) {
    throw new MainnetPreflightError("Agent USDC balance is below the exact one-cent payment.");
  }

  const ethBalance = await readPreflightValue(
    "Could not read the agent Base ETH balance.",
    () => options.runtime.getEthBalance(options.agentAddress),
  );
  if (ethBalance === 0n) {
    throw new MainnetPreflightError("Agent has no Base ETH for gas.");
  }

  const transfer = {
    from: options.agentAddress,
    to: options.expectedPayTo,
    amount: DEMO_AMOUNT_USDC,
  } as const;

  await readPreflightValue(
    "USDC transfer simulation failed.",
    () => options.runtime.simulateTransfer(transfer),
  );
  const estimatedGas = await readPreflightValue(
    "Could not estimate USDC transfer gas.",
    () => options.runtime.estimateTransferGas(transfer),
  );
  const upperFeePerGas = await readPreflightValue(
    "Could not estimate an upper fee per gas.",
    () => options.runtime.estimateUpperFeePerGas(),
  );

  const bufferedGasCost = estimatedGas * upperFeePerGas * GAS_BUFFER_MULTIPLIER;
  if (ethBalance < bufferedGasCost) {
    throw new MainnetPreflightError(
      "Agent Base ETH balance is below the buffered gas estimate.",
    );
  }

  options.log(`Agent balance: ${formatUnits(usdcBalance, 6)} USDC`);
  options.log(`Agent gas balance: ${formatEther(ethBalance)} ETH`);

  if (!options.executeRequested) {
    options.log("PAYMENT NOT SENT: preview mode; pass --execute to authorize the transfer.");
    return false;
  }
  if (!options.mainnetAllowed) {
    throw new MainnetPreflightError(
      "ALLOW_MAINNET_PAYMENTS must be exactly true to authorize a Base Mainnet payment.",
    );
  }

  return true;
}

export function createMainnetPreflightRuntime(
  rpcUrl: string,
): MainnetPreflightRuntime {
  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });

  return {
    getChainId: () => publicClient.getChainId(),
    getEthBalance: (address) => publicClient.getBalance({ address }),
    getUsdcBalance: (address) => publicClient.readContract({
      address: USDC_BASE,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [address],
    }),
    simulateTransfer: async ({ from, to, amount }) => {
      await publicClient.simulateContract({
        account: from,
        address: USDC_BASE,
        abi: usdcAbi,
        functionName: "transfer",
        args: [to, amount],
      });
    },
    estimateTransferGas: ({ from, to, amount }) => publicClient.estimateContractGas({
      account: from,
      address: USDC_BASE,
      abi: usdcAbi,
      functionName: "transfer",
      args: [to, amount],
    }),
    estimateUpperFeePerGas: async () => {
      const fees = await publicClient.estimateFeesPerGas();
      if ("maxFeePerGas" in fees && fees.maxFeePerGas !== undefined) {
        return fees.maxFeePerGas;
      }
      if ("gasPrice" in fees && fees.gasPrice !== undefined) {
        return fees.gasPrice;
      }
      throw new MainnetPreflightError("RPC returned no usable upper fee per gas.");
    },
  };
}

function validateStaticPayment(options: MainnetPreflightOptions): void {
  const { context } = options;
  if (context.requestUrl !== options.expectedRequestUrl) {
    throw new MainnetPreflightError("Payment request URL does not match the expected Vendor URL.");
  }
  if (context.chainId !== BASE_CHAIN_ID) {
    throw new MainnetPreflightError("Payment chain must be Base Mainnet (8453).");
  }
  if (context.network !== "base") {
    throw new MainnetPreflightError("Payment network must be base.");
  }
  if (context.payTo !== options.expectedPayTo) {
    throw new MainnetPreflightError("Payment recipient does not match the expected Vendor wallet.");
  }
  if (context.token !== USDC_BASE) {
    throw new MainnetPreflightError("Payment token must be the official Base USDC contract.");
  }
  if (context.priceUsdc !== DEMO_PRICE_USDC) {
    throw new MainnetPreflightError("Payment price must be exactly 0.01 USDC.");
  }
  if (context.amount !== DEMO_AMOUNT_USDC) {
    throw new MainnetPreflightError("Payment amount must be exactly 10000 USDC base units.");
  }
}

async function readPreflightValue<T>(
  message: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof MainnetPreflightError) throw error;
    throw new MainnetPreflightError(message, { cause: error });
  }
}
