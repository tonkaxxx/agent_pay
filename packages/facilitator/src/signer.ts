import type { FacilitatorEvmSigner } from "@x402/evm";
import { toFacilitatorEvmSigner } from "@x402/evm";
import {
  createPublicClient,
  createWalletClient,
  http,
  publicActions,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

import type { FacilitatorConfig } from "./config.js";

const BASE_CHAIN_ID = 8453;

interface ChainIdReader {
  getChainId(): Promise<number>;
}

type SignerClient = ChainIdReader & {
  readContract(args: Parameters<FacilitatorEvmSigner["readContract"]>[0]): Promise<unknown>;
  verifyTypedData(
    args: Parameters<FacilitatorEvmSigner["verifyTypedData"]>[0],
  ): Promise<boolean>;
  writeContract(
    args: Parameters<FacilitatorEvmSigner["writeContract"]>[0],
  ): Promise<Hex>;
  sendTransaction(
    args: Parameters<FacilitatorEvmSigner["sendTransaction"]>[0],
  ): Promise<Hex>;
  waitForTransactionReceipt(
    args: Parameters<FacilitatorEvmSigner["waitForTransactionReceipt"]>[0],
  ): ReturnType<FacilitatorEvmSigner["waitForTransactionReceipt"]>;
  getCode(args: Parameters<FacilitatorEvmSigner["getCode"]>[0]): Promise<Hex | undefined>;
};

export async function assertBaseMainnet(reader: ChainIdReader): Promise<void> {
  const chainId = await reader.getChainId();
  if (chainId !== BASE_CHAIN_ID) {
    throw new Error("BASE_MAINNET_RPC_URL must target Base Mainnet");
  }
}

export async function createMainnetFacilitatorSigner(
  config: Pick<FacilitatorConfig, "privateKey" | "rpcUrl">,
): Promise<FacilitatorEvmSigner> {
  const account = privateKeyToAccount(config.privateKey);
  const client = createWalletClient({
    account,
    chain: base,
    transport: http(config.rpcUrl),
  }).extend(publicActions) as unknown as SignerClient;

  await assertBaseMainnet(client);

  return toFacilitatorEvmSigner({
    address: account.address,
    readContract: args => client.readContract(args),
    verifyTypedData: args => client.verifyTypedData(args),
    writeContract: args => client.writeContract(args),
    sendTransaction: args => client.sendTransaction(args),
    waitForTransactionReceipt: args => client.waitForTransactionReceipt(args),
    getCode: args => client.getCode(args),
  });
}

export function createBaseMainnetHealthcheck(rpcUrl: string): () => Promise<boolean> {
  const client = createPublicClient({ chain: base, transport: http(rpcUrl) });
  return async () => {
    try {
      await assertBaseMainnet(client);
      return true;
    } catch {
      return false;
    }
  };
}

export function facilitatorAddress(signer: FacilitatorEvmSigner): Address {
  const [address] = signer.getAddresses();
  if (!address) {
    throw new Error("Facilitator signer has no address");
  }
  return address;
}
