import { BASE_USDC } from "@agentpay/server";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

import type { TransferChain } from "./transfer-engine";
import type { SettlementReconciliationChain } from "./reconciliation";

const authorizationAbi = parseAbi([
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
  "event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce)",
]);

export function hasRequiredConfirmations(
  currentBlock: bigint,
  receiptBlock: bigint,
): boolean {
  return currentBlock >= receiptBlock + 1n;
}

export function createBasePayoutChain(rpcUrl: string, privateKey: Hex): TransferChain {
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl, { timeout: 30_000 });
  const publicClient = createPublicClient({ chain: base, transport });
  const walletClient = createWalletClient({ account, chain: base, transport });

  return {
    nativeBalance: () => publicClient.getBalance({ address: account.address }),
    nextNonce: async () => BigInt(await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    })),
    signUsdcTransfer: async input => {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [input.recipient as Address, BigInt(input.amountAtomic)],
      });
      const request = await walletClient.prepareTransactionRequest({
        account,
        chain: base,
        to: BASE_USDC,
        data,
        nonce: Number(input.nonce),
        type: "eip1559",
      });
      const multiplier = 100n + BigInt(Math.max(0, input.attemptNumber - 1)) * 25n;
      const bumpedRequest = {
        ...request,
        ...(request.maxFeePerGas === undefined
          ? {}
          : { maxFeePerGas: (request.maxFeePerGas * multiplier) / 100n }),
        ...(request.maxPriorityFeePerGas === undefined
          ? {}
          : { maxPriorityFeePerGas: (request.maxPriorityFeePerGas * multiplier) / 100n }),
      };
      const rawTransaction = await walletClient.signTransaction(bumpedRequest);
      return {
        rawTransaction,
        transactionHash: keccak256(rawTransaction),
      };
    },
    broadcast: async rawTransaction => {
      try {
        await publicClient.sendRawTransaction({ serializedTransaction: rawTransaction as Hex });
      } catch (error) {
        if (error instanceof Error && /already known/i.test(error.message)) return;
        throw error;
      }
    },
    receipt: async transactionHash => {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash as Hex });
        if (receipt.status === "reverted") return "reverted";
        const currentBlock = await publicClient.getBlockNumber();
        return currentBlock >= receipt.blockNumber + 1n ? "confirmed" : "pending";
      } catch (error) {
        if (error instanceof Error && /not found|could not be found/i.test(error.message)) {
          return "pending";
        }
        throw error;
      }
    },
  };
}

export function createBaseReconciliationChain(rpcUrl: string): SettlementReconciliationChain {
  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl, { timeout: 30_000 }),
  });
  async function blockAtOrBefore(timestampSeconds: bigint, currentBlock: bigint): Promise<bigint> {
    let low = 0n;
    let high = currentBlock;
    while (low < high) {
      const middle = (low + high + 1n) / 2n;
      const block = await publicClient.getBlock({ blockNumber: middle });
      if (block.timestamp <= timestampSeconds) low = middle;
      else high = middle - 1n;
    }
    return low;
  }
  return {
    authorizationUsed: async input => {
      const payer = input.payerAddress as Address;
      const nonce = input.nonce as Hex;
      const used = await publicClient.readContract({
        address: BASE_USDC,
        abi: authorizationAbi,
        functionName: "authorizationState",
        args: [payer, nonce],
      });
      if (!used) return null;

      const currentBlock = await publicClient.getBlockNumber();
      const createdBlock = await blockAtOrBefore(
        BigInt(Math.floor(input.createdAt.getTime() / 1000)),
        currentBlock,
      );
      const validBeforeBlock = await blockAtOrBefore(
        BigInt(Math.floor(input.validBefore.getTime() / 1000)),
        currentBlock,
      );
      const fromBlock = createdBlock > 100n ? createdBlock - 100n : 0n;
      const toBlock = validBeforeBlock + 100n < currentBlock
        ? validBeforeBlock + 100n
        : currentBlock;
      const [logs, canceledLogs] = await Promise.all([
        publicClient.getLogs({
          address: BASE_USDC,
          event: authorizationAbi[1],
          args: { authorizer: payer, nonce },
          fromBlock,
          toBlock,
        }),
        publicClient.getLogs({
          address: BASE_USDC,
          event: authorizationAbi[2],
          args: { authorizer: payer, nonce },
          fromBlock,
          toBlock,
        }),
      ]);
      for (const log of [...logs].reverse()) {
        if (!log.transactionHash) continue;
        const receipt = await publicClient.getTransactionReceipt({ hash: log.transactionHash });
        const matchingTransfer = receipt.logs.some((receiptLog) => {
          if (receiptLog.address.toLowerCase() !== BASE_USDC.toLowerCase()) return false;
          try {
            const decoded = decodeEventLog({ abi: erc20Abi, data: receiptLog.data, topics: receiptLog.topics });
            return decoded.eventName === "Transfer" &&
              decoded.args.from.toLowerCase() === input.payerAddress.toLowerCase() &&
              decoded.args.to.toLowerCase() === input.collectionAddress.toLowerCase() &&
              decoded.args.value === BigInt(input.amountAtomic);
          } catch {
            return false;
          }
        });
        if (receipt.status === "success" && matchingTransfer) {
          if (!hasRequiredConfirmations(currentBlock, receipt.blockNumber)) {
            throw new Error("Settlement is awaiting confirmations");
          }
          return log.transactionHash;
        }
      }
      if (canceledLogs.length > 0) return null;
      throw new Error("Used authorization transfer was not found in the reconciliation window");
    },
  };
}
