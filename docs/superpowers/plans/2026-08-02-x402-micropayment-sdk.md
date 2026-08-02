# X402 Micropayment SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать два publishable TypeScript-пакета и рабочее Base Sepolia демо для HTTP 402-платежей в USDC.

**Architecture:** Сервер разделяет Express middleware и framework-neutral verifier, проверяющий подтверждённые USDC `Transfer`-логи и атомарно блокирующий replay. Клиент строит повторяемый `Request`, строго валидирует 402 payload, выполняет ограниченный ERC-20 transfer через `viem` и повторяет HTTP-запрос ровно один раз.

**Tech Stack:** Node.js 20+, TypeScript strict/ESM, pnpm workspaces, viem, Express 5, Vitest, Supertest, tsx, dotenv.

## Global Constraints

- Runtime: Node.js `>=20`; package manager: `pnpm@11.18.0` через Corepack.
- TypeScript: strict mode, ES Modules, NodeNext resolution; `ethers.js` запрещён.
- Все относительные импорты TypeScript, которые попадут в package output, используют расширение `.js`.
- Поддерживаемые chain ID: Base Mainnet `8453` и Base Sepolia `84532`.
- USDC Base Mainnet: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- USDC Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- USDC имеет 6 decimals; цены и лимиты обрабатываются только через integer units, без `number`/floating point.
- HTTP payment header: `X-Payment-Tx`; допустим ровно один автоматический платёж и один retry.
- Default price cap клиента: `1.00` USDC; default confirmations обеих сторон: `1`.
- Private key и `.env` никогда не логируются и не коммитятся.
- Автоматические тесты не обращаются к реальному RPC и не расходуют средства.
- MVP replay-store хранится в памяти процесса; API допускает замену атомарным внешним store.

---

## Карта файлов

- `package.json` — workspace scripts и development dependencies.
- `pnpm-workspace.yaml` — обнаружение `packages/*`.
- `pnpm-lock.yaml` — воспроизводимое дерево зависимостей, создаётся `pnpm install`.
- `tsconfig.json` — общие strict/ESM настройки, aliases исходников пакетов и проверка examples.
- `vitest.config.ts` — единый Node test runner для packages и examples.
- `packages/server/src/verifier.ts` — chain registry, типы, config validation, receipt/log verification и replay-store.
- `packages/server/src/middleware.ts` — Express 402/403/503 adapter.
- `packages/server/src/index.ts` — публичные exports server SDK.
- `packages/server/test/verifier.test.ts` — verifier happy path, failures, confirmations и replay.
- `packages/server/test/middleware.test.ts` — HTTP-поведение Express middleware.
- `packages/client/src/agentFetch.ts` — payload validation, typed errors, viem runtime, transfer и retry.
- `packages/client/src/index.ts` — публичные exports client SDK.
- `packages/client/test/agentFetch.test.ts` — transparent fetch, policy validation, payment и retry.
- `examples/vendor-api.ts` — Base Sepolia Vendor API и экспортируемая app factory для smoke test.
- `examples/vendor-api.test.ts` — проверка реального demo route без RPC-вызова.
- `examples/ai-agent.ts` — CLI-вызов Vendor API через `createAgentFetch`.
- `.env.example` — полный перечень переменных без секретов.
- `.gitignore` — исключение `.env`, `node_modules`, `dist`, coverage и editor artifacts.
- `README.md` — API, security caveats и пошаговый запуск demo.

---

### Task 1: Workspace и успешная on-chain верификация

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/verifier.ts`
- Create: `packages/server/src/index.ts`
- Create: `packages/server/test/verifier.test.ts`
- Create: `pnpm-lock.yaml` via package manager

**Interfaces:**
- Produces: `SupportedChainId`, `PaymentRequirements`, `ReceiptClient`, `ReplayStore`, `InMemoryReplayStore`, `PaymentVerificationResult`, `PaymentVerifier`, `createPaymentVerifier(options)` and `getUsdcAddress(chainId)`.
- Consumes: только `viem`; Express ещё не участвует.

- [ ] **Step 1: Создать workspace manifests и test harness**

Root `package.json` должен содержать:

```json
{
  "name": "x402-usdc-sdk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.18.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "pnpm --recursive --filter './packages/*' run build",
    "typecheck": "pnpm --recursive --filter './packages/*' run typecheck && tsc -p tsconfig.json",
    "test": "vitest run",
    "demo:vendor": "tsx examples/vendor-api.ts",
    "demo:agent": "tsx examples/ai-agent.ts"
  },
  "devDependencies": {
    "@types/express": "^5.0.6",
    "@types/node": "^26.1.2",
    "@types/supertest": "^7.2.1",
    "dotenv": "^17.4.2",
    "express": "^5.2.1",
    "supertest": "^7.2.2",
    "tsx": "^4.23.4",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@x402/server": ["packages/server/src/index.ts"],
      "@x402/client": ["packages/client/src/index.ts"]
    }
  },
  "include": ["examples/**/*.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@x402/server": fileURLToPath(new URL("./packages/server/src/index.ts", import.meta.url)),
      "@x402/client": fileURLToPath(new URL("./packages/client/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "examples/**/*.test.ts"],
    clearMocks: true,
  },
});
```

Server manifest:

```json
{
  "name": "@x402/server",
  "version": "0.1.0",
  "type": "module",
  "sideEffects": false,
  "files": ["dist"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "viem": "^2.55.10" },
  "peerDependencies": { "express": ">=5.0.0" }
}
```

Package tsconfig:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test", "dist"]
}
```

`.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
.DS_Store
.vscode/
```

- [ ] **Step 2: Установить зависимости и создать lockfile**

Run: `corepack pnpm install`

Expected: exit `0`, создан `pnpm-lock.yaml`, установлены workspace dependencies.

- [ ] **Step 3: Написать failing happy-path test verifier**

В `packages/server/test/verifier.test.ts` создать fake receipt client и реальный ABI-encoded `Transfer` log:

```ts
const hash = `0x${"a".repeat(64)}` as Hash;
const payTo = "0x1111111111111111111111111111111111111111" as Address;
const from = "0x2222222222222222222222222222222222222222" as Address;
const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

const topics = encodeEventTopics({
  abi: parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]),
  eventName: "Transfer",
  args: { from, to: payTo },
});
const data = encodeAbiParameters([{ type: "uint256" }], [10_000n]);

const client: ReceiptClient = {
  getTransactionReceipt: vi.fn().mockResolvedValue({
    status: "success",
    blockNumber: 100n,
    logs: [{ address: usdc, topics, data }],
  }),
  getBlockNumber: vi.fn().mockResolvedValue(100n),
};

const verify = createPaymentVerifier({
  requirements: { priceUsdc: "0.01", payTo, chainId: 84532 },
  publicClient: client,
});

await expect(verify(hash)).resolves.toEqual({ valid: true });
```

- [ ] **Step 4: Запустить test и подтвердить ожидаемое падение**

Run: `corepack pnpm vitest run packages/server/test/verifier.test.ts`

Expected: FAIL, потому что `createPaymentVerifier` и связанные exports ещё не существуют.

- [ ] **Step 5: Реализовать минимальный успешный verifier**

В `verifier.ts` определить chain registry и строгие границы:

```ts
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

export type PaymentVerificationResult =
  | { valid: true }
  | { valid: false; reason: PaymentFailureReason; retryable: boolean };

export type PaymentVerifier = (txHash: string) => Promise<PaymentVerificationResult>;
```

Registry должен возвращать checksummed official address для обоих chain ID. Цена валидируется regex `^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$`, затем `parseUnits(value, 6)` и проверкой `> 0n`. Адрес нормализуется через `getAddress`.

Core loop фильтрует адрес токена, декодирует только `Transfer` и суммирует значения на `payTo`:

```ts
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
```

На этом шаге test должен получить `{ valid: true }`; failure reasons и replay дополняются в Task 2.

`packages/server/src/index.ts` явно re-export-ит все публичные values и types из `verifier.ts`; package consumer не импортирует внутренние пути.

- [ ] **Step 6: Запустить server test и typecheck**

Run: `corepack pnpm vitest run packages/server/test/verifier.test.ts && corepack pnpm --filter @x402/server typecheck`

Expected: оба процесса exit `0`.

- [ ] **Step 7: Закоммитить workspace и happy path**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json vitest.config.ts .gitignore packages/server
git commit -m "feat(server): verify USDC transfer receipts"
```

---

### Task 2: Verifier security boundaries и replay protection

**Files:**
- Modify: `packages/server/src/verifier.ts`
- Modify: `packages/server/test/verifier.test.ts`

**Interfaces:**
- Consumes: `createPaymentVerifier`, `ReceiptClient` и `PaymentVerificationResult` из Task 1.
- Produces: полный `PaymentFailureReason`, `InMemoryReplayStore` и безопасный default process-wide replay-store.

- [ ] **Step 1: Добавить failing tests для всех отказов**

Перед cases определить test helpers:

```ts
type TestReceipt = Awaited<ReturnType<ReceiptClient["getTransactionReceipt"]>>;
const otherToken = "0x3333333333333333333333333333333333333333" as Address;
const otherRecipient = "0x4444444444444444444444444444444444444444" as Address;
const transferAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function makeReceipt({
  status = "success",
  token = usdc,
  to = payTo,
  values = [10_000n],
}: {
  status?: "success" | "reverted";
  token?: Address;
  to?: Address;
  values?: readonly bigint[];
} = {}): TestReceipt {
  return {
    status,
    blockNumber: 100n,
    logs: values.map((value) => ({
      address: token,
      topics: encodeEventTopics({
        abi: transferAbi,
        eventName: "Transfer",
        args: { from, to },
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [value]),
    })),
  };
}

function makeClient(testReceipt: TestReceipt, latestBlock = testReceipt.blockNumber): ReceiptClient {
  return {
    getTransactionReceipt: vi.fn().mockResolvedValue(testReceipt),
    getBlockNumber: vi.fn().mockResolvedValue(latestBlock),
  };
}

function verifierFor(client: ReceiptClient, confirmations = 1): PaymentVerifier {
  return createPaymentVerifier({
    requirements: { priceUsdc: "0.01", payTo, chainId: 84532 },
    publicClient: client,
    confirmations,
    replayStore: new InMemoryReplayStore(),
  });
}
```

Добавить отдельные tests со следующими точными ожиданиями. Test-файл содержит `makeReceipt({ status, token, to, values })`, который возвращает `TestReceipt` и кодирует каждый элемент `values` отдельным USDC `Transfer`-логом:

```ts
expect(await verify("not-a-hash")).toMatchObject({
  valid: false,
  reason: "invalid_tx_hash",
  retryable: false,
});

expect(await verifierFor(makeClient(makeReceipt({ status: "reverted" })))(hash)).toMatchObject({
  valid: false,
  reason: "transaction_failed",
});

expect(await verifierFor(makeClient(makeReceipt({ token: otherToken })))(hash)).toMatchObject({
  valid: false,
  reason: "insufficient_payment",
});

expect(await verifierFor(makeClient(makeReceipt({ to: otherRecipient })))(hash)).toMatchObject({
  valid: false,
  reason: "insufficient_payment",
});

expect(await verifierFor(makeClient(makeReceipt({ values: [9_999n] })))(hash)).toMatchObject({
  valid: false,
  reason: "insufficient_payment",
});
```

Добавить tests на сумму двух логов `6_000n + 4_000n`, insufficient confirmations (`receipt.blockNumber = 100n`, latest `100n`, confirmations `2`), `TransactionReceiptNotFoundError`, generic RPC error, повторный hash и два параллельных `verify(hash)` через `Promise.all`.

Точные результаты:

- not found → `transaction_not_found`, `retryable: false`;
- confirmations → `insufficient_confirmations`, `retryable: false`;
- generic RPC → `verification_unavailable`, `retryable: true`;
- второй/проигравший concurrent claim → `transaction_replayed`, `retryable: false`;
- split payment → один `{ valid: true }`.

- [ ] **Step 2: Запустить tests и подтвердить падения**

Run: `corepack pnpm vitest run packages/server/test/verifier.test.ts`

Expected: FAIL на failure mapping, confirmations и replay cases.

- [ ] **Step 3: Реализовать failure mapping и atomic replay claim**

Определить union без свободных строк:

```ts
export type PaymentFailureReason =
  | "invalid_tx_hash"
  | "transaction_not_found"
  | "transaction_failed"
  | "insufficient_confirmations"
  | "insufficient_payment"
  | "transaction_replayed"
  | "verification_unavailable";

export class InMemoryReplayStore implements ReplayStore {
  readonly #used = new Set<string>();

  claim(key: string): boolean {
    if (this.#used.has(key)) return false;
    this.#used.add(key);
    return true;
  }
}
```

После receipt validation вычислять confirmations как `latestBlock - receipt.blockNumber + 1n`. `TransactionReceiptNotFoundError` преобразовать в non-retryable not-found, остальные RPC exceptions — в retryable unavailable. После проверки суммы выполнить `await replayStore.claim(`${chainId}:${hash.toLowerCase()}`)`; никаких `await` между внутренним check и add default store нет.

- [ ] **Step 4: Запустить verifier tests, typecheck и build**

Run: `corepack pnpm vitest run packages/server/test/verifier.test.ts && corepack pnpm --filter @x402/server typecheck && corepack pnpm --filter @x402/server build`

Expected: все команды exit `0`, `packages/server/dist/index.js` создан.

- [ ] **Step 5: Закоммитить verifier hardening**

```bash
git add packages/server/src/verifier.ts packages/server/test/verifier.test.ts
git commit -m "feat(server): prevent invalid and replayed payments"
```

---

### Task 3: Express payment middleware

**Files:**
- Create: `packages/server/src/middleware.ts`
- Create: `packages/server/test/middleware.test.ts`
- Modify: `packages/server/src/index.ts`

**Interfaces:**
- Consumes: `PaymentRequirements`, `ReceiptClient`, `ReplayStore`, `createPaymentVerifier`.
- Produces: `PaymentRequiredPayload`, `PaymentMiddlewareOptions`, `PAYMENT_HEADER` and `paymentMiddleware(options): RequestHandler`.

- [ ] **Step 1: Написать failing HTTP tests**

Через Express + Supertest проверить точный 402:

```ts
const app = express();
app.get(
  "/api/data",
  paymentMiddleware({
    priceUsdc: "0.01",
    payTo,
    chainId: 84532,
    publicClient: client,
  }),
  (_request, response) => response.json({ data: "paid" }),
);

await request(app).get("/api/data").expect(402).expect({
  error: "Payment Required",
  priceUsdc: "0.01",
  payTo,
  network: "base-sepolia",
  chainId: 84532,
});
```

Добавить valid receipt + header → `200 { data: "paid" }`, insufficient payment → `403 { error: "Invalid Payment", reason: "insufficient_payment" }`, RPC error → `503 { error: "Payment Verification Unavailable", reason: "verification_unavailable" }`.

- [ ] **Step 2: Запустить middleware tests и подтвердить падение**

Run: `corepack pnpm vitest run packages/server/test/middleware.test.ts`

Expected: FAIL, module `middleware.ts` отсутствует.

- [ ] **Step 3: Реализовать Express adapter**

Опции должны быть union: либо `rpcUrl`, либо injected `publicClient`, плюс `priceUsdc`, `payTo`, `chainId`, optional `usdcAddress`, `confirmations`, `replayStore`. При `rpcUrl` создать viem client с `base`/`baseSepolia` и `http(rpcUrl)`.

Core handler:

```ts
return async (_request, response, next) => {
  const txHash = _request.get(PAYMENT_HEADER);
  if (!txHash) {
    response.status(402).json(payload);
    return;
  }

  const result = await verify(txHash);
  if (result.valid) {
    next();
    return;
  }

  if (result.retryable) {
    response.status(503).json({
      error: "Payment Verification Unavailable",
      reason: result.reason,
    });
    return;
  }

  response.status(403).json({ error: "Invalid Payment", reason: result.reason });
};
```

В `index.ts` экспортировать middleware values/types и verifier values/types явными named exports.

- [ ] **Step 4: Запустить весь server suite и сборку**

Run: `corepack pnpm vitest run packages/server && corepack pnpm --filter @x402/server typecheck && corepack pnpm --filter @x402/server build`

Expected: tests PASS, typecheck/build exit `0`.

- [ ] **Step 5: Закоммитить middleware**

```bash
git add packages/server/src/middleware.ts packages/server/src/index.ts packages/server/test/middleware.test.ts
git commit -m "feat(server): add Express payment middleware"
```

---

### Task 4: Client fetch contract и 402 policy validation

**Files:**
- Create: `packages/client/package.json`
- Create: `packages/client/tsconfig.json`
- Create: `packages/client/src/agentFetch.ts`
- Create: `packages/client/src/index.ts`
- Create: `packages/client/test/agentFetch.test.ts`

**Interfaces:**
- Produces: `AgentFetch`, `AgentFetchConfig`, `PaymentRuntime`, `AgentFetchDependencies`, `X402ProtocolError`, `X402PaymentError`, `createAgentFetch(config, dependencies?)`.
- Consumes: platform `Request`/`Response`/`fetch`, `viem` address/unit/private-key validation.

- [ ] **Step 1: Создать client package manifests**

`packages/client/package.json`:

```json
{
  "name": "@x402/client",
  "version": "0.1.0",
  "type": "module",
  "sideEffects": false,
  "files": ["dist"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "viem": "^2.55.10" }
}
```

`packages/client/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test", "dist"]
}
```

- [ ] **Step 2: Написать failing tests для transparent fetch и policy**

Использовать валидный deterministic test key:

```ts
const privateKey = `0x${"11".repeat(32)}` as Hex;
const fetchMock = vi.fn<typeof fetch>();
const createPaymentRuntime = vi.fn();
const dependencies = { fetch: fetchMock, createPaymentRuntime };
```

Dependency boundary определяется до реализации policy flow:

```ts
export interface AgentFetchDependencies {
  fetch: typeof globalThis.fetch;
  createPaymentRuntime(input: {
    privateKey: Hex;
    rpcUrl: string;
    chainId: 8453 | 84532;
  }): PaymentRuntime;
}
```

Tests должны проверить:

```ts
const ok = new Response(JSON.stringify({ ok: true }), { status: 200 });
fetchMock.mockResolvedValueOnce(ok);
const agentFetch = createAgentFetch({ privateKey, rpcUrl: "https://rpc.example" }, dependencies);
await expect(agentFetch("https://vendor.example/data")).resolves.toBe(ok);
expect(createPaymentRuntime).not.toHaveBeenCalled();
```

Добавить 402 cases с invalid JSON, отсутствующим `priceUsdc`, malformed `payTo`, chain ID `1`, mismatch `network: "base"` при `84532`, price `0`, более 6 decimals и price `1.01` при cap `1.00`. Каждый case обязан бросать `X402ProtocolError` с конкретным `code`; runtime и второй fetch не вызываются.

- [ ] **Step 3: Запустить client tests и подтвердить падение**

Run: `corepack pnpm vitest run packages/client/test/agentFetch.test.ts`

Expected: FAIL, `createAgentFetch` ещё не существует.

- [ ] **Step 4: Реализовать config/payload validation и non-402 path**

Определить errors:

```ts
export class X402ProtocolError extends Error {
  constructor(public readonly code: ProtocolErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "X402ProtocolError";
  }
}

export class X402PaymentError extends Error {
  constructor(public readonly code: PaymentErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "X402PaymentError";
  }
}
```

`ProtocolErrorCode` включает `invalid_payment_response`, `unsupported_chain`, `network_mismatch`, `payment_limit_exceeded`; `PaymentErrorCode` резервирует `rpc_chain_mismatch`, `transfer_failed`, `transaction_failed` для Task 5.

`createAgentFetch` при создании валидирует key через `privateKeyToAccount`, HTTP(S) RPC URL, positive cap и confirmations. Возвращаемая функция создаёт `const request = new Request(input, init)` и отправляет `dependencies.fetch(request.clone())`. Для non-402 немедленно возвращает исходный `Response`. Для 402 безопасно парсит JSON как `unknown`, validates record fields, normalizes address, maps chain/network, parses units и применяет cap.

- [ ] **Step 5: Запустить policy tests и typecheck**

Run: `corepack pnpm vitest run packages/client/test/agentFetch.test.ts && corepack pnpm --filter @x402/client typecheck`

Expected: tests и typecheck PASS.

- [ ] **Step 6: Закоммитить client contract**

```bash
git add packages/client
git commit -m "feat(client): validate HTTP 402 payment requirements"
```

---

### Task 5: USDC transfer, confirmation и безопасный retry

**Files:**
- Modify: `packages/client/src/agentFetch.ts`
- Modify: `packages/client/test/agentFetch.test.ts`
- Modify: `packages/client/src/index.ts`

**Interfaces:**
- Consumes: validated requirements из Task 4.
- Produces: полностью работающий `createAgentFetch` и default viem-backed `PaymentRuntime`.

- [ ] **Step 1: Написать failing end-to-end client tests с fake runtime**

Полный happy path:

```ts
fetchMock
  .mockResolvedValueOnce(new Response(JSON.stringify({
    error: "Payment Required",
    priceUsdc: "0.01",
    payTo,
    network: "base-sepolia",
    chainId: 84532,
  }), { status: 402, headers: { "content-type": "application/json" } }))
  .mockResolvedValueOnce(new Response(JSON.stringify({ data: "paid" }), { status: 200 }));

const runtime: PaymentRuntime = {
  getChainId: vi.fn().mockResolvedValue(84532),
  transferUsdc: vi.fn().mockResolvedValue(hash),
  waitForReceipt: vi.fn().mockResolvedValue({ status: "success" }),
};
createPaymentRuntime.mockReturnValue(runtime);

const response = await agentFetch("https://vendor.example/data", {
  method: "POST",
  headers: { "content-type": "application/json", "x-agent": "demo" },
  body: JSON.stringify({ prompt: "hello" }),
});

expect(response.status).toBe(200);
expect(runtime.transferUsdc).toHaveBeenCalledWith({ token: USDC_BASE_SEPOLIA, to: payTo, amount: 10_000n });
expect(runtime.waitForReceipt).toHaveBeenCalledWith(hash, 1);
```

Проверить второй `Request`: method/body/original headers сохранены, `X-Payment-Tx` равен hash. Добавить tests: RPC возвращает `8453`; transfer бросает; receipt `reverted`; retry снова возвращает 402 и вызывает transfer ровно один раз.

- [ ] **Step 2: Запустить payment tests и подтвердить падение**

Run: `corepack pnpm vitest run packages/client/test/agentFetch.test.ts`

Expected: FAIL, runtime transfer/retry ещё не вызываются.

- [ ] **Step 3: Реализовать PaymentRuntime и retry**

Runtime boundary:

```ts
export interface PaymentRuntime {
  getChainId(): Promise<number>;
  transferUsdc(input: { token: Address; to: Address; amount: bigint }): Promise<Hash>;
  waitForReceipt(hash: Hash, confirmations: number): Promise<{ status: "success" | "reverted" }>;
}
```

Default factory выбирает `base`/`baseSepolia`, создаёт account через `privateKeyToAccount`, public client и wallet client на одном `http(rpcUrl)` transport. `transferUsdc` вызывает:

```ts
walletClient.writeContract({
  address: token,
  abi: parseAbi(["function transfer(address to, uint256 value) returns (bool)"]),
  functionName: "transfer",
  args: [to, amount],
});
```

До transfer вызвать `runtime.getChainId()` и строго сравнить с payload. После transfer ждать receipt; `reverted` преобразовать в `X402PaymentError("transaction_failed", ...)`, исключение write/wait — в `X402PaymentError("transfer_failed", ..., { cause })`.

Retry строить из неиспользованного clone:

```ts
const retryRequest = request.clone();
const retryHeaders = new Headers(retryRequest.headers);
retryHeaders.set(PAYMENT_HEADER, hash);
return fetchImpl(new Request(retryRequest, { headers: retryHeaders }));
```

Никакого цикла и рекурсивного вызова `agentFetch` нет, поэтому повторный 402 не создаёт второй платёж.

- [ ] **Step 4: Запустить client suite, typecheck и build**

Run: `corepack pnpm vitest run packages/client && corepack pnpm --filter @x402/client typecheck && corepack pnpm --filter @x402/client build`

Expected: все tests PASS, команды exit `0`, client dist содержит JS, declarations и maps.

- [ ] **Step 5: Закоммитить payment flow**

```bash
git add packages/client/src packages/client/test
git commit -m "feat(client): pay USDC and retry HTTP 402 requests"
```

---

### Task 6: Демо, документация и release-grade verification

**Files:**
- Create: `examples/vendor-api.ts`
- Create: `examples/vendor-api.test.ts`
- Create: `examples/ai-agent.ts`
- Create: `.env.example`
- Create: `README.md`
- Modify: `package.json` only if typecheck/test scripts need a path correction discovered by this task

**Interfaces:**
- Consumes: public exports `paymentMiddleware` и `createAgentFetch` из собранных packages.
- Produces: runnable Base Sepolia demo, user-facing commands и final verified workspace.

- [ ] **Step 1: Написать failing Vendor API smoke test**

`examples/vendor-api.test.ts`:

```ts
const app = createVendorApp({
  vendorWalletAddress: "0x1111111111111111111111111111111111111111",
  rpcUrl: "https://sepolia.base.org",
});

await request(app).get("/api/data").expect(402).expect(({ body }) => {
  expect(body).toMatchObject({
    error: "Payment Required",
    priceUsdc: "0.01",
    network: "base-sepolia",
    chainId: 84532,
  });
});
```

Test не отправляет payment header, поэтому middleware не обращается к RPC.

- [ ] **Step 2: Запустить smoke test и подтвердить падение**

Run: `corepack pnpm vitest run examples/vendor-api.test.ts`

Expected: FAIL, `createVendorApp` отсутствует.

- [ ] **Step 3: Реализовать оба demo scripts**

`vendor-api.ts` экспортирует:

```ts
export function createVendorApp(config: { vendorWalletAddress: Address; rpcUrl: string }) {
  const app = express();
  app.get(
    "/api/data",
    paymentMiddleware({
      priceUsdc: "0.01",
      payTo: config.vendorWalletAddress,
      chainId: 84532,
      rpcUrl: config.rpcUrl,
    }),
    (_request, response) => response.json({
      data: "The paid signal is 42.",
      paidWith: "USDC",
      network: "base-sepolia",
    }),
  );
  return app;
}
```

Direct-execution guard сравнивает `import.meta.url` с `pathToFileURL(process.argv[1]).href`, читает `VENDOR_WALLET_ADDRESS`, `BASE_SEPOLIA_RPC_URL`, валидирует их, запускает `listen(PORT)` и печатает только URL/цену/получателя.

`ai-agent.ts` читает `AGENT_PRIVATE_KEY`, `BASE_SEPOLIA_RPC_URL`, optional `VENDOR_API_URL`, создаёт agent fetch с cap `0.10`, проверяет `response.ok`, печатает status и parsed JSON. Оба файла импортируют `dotenv/config`.

- [ ] **Step 4: Запустить smoke test и TypeScript check examples**

Run: `corepack pnpm vitest run examples/vendor-api.test.ts && corepack pnpm exec tsc -p tsconfig.json`

Expected: test PASS и TypeScript exit `0`; лишнее поле `network` отсутствует в финальном файле.

- [ ] **Step 5: Добавить environment template и README**

`.env.example` содержит безопасные значения:

```dotenv
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
VENDOR_WALLET_ADDRESS=0x1111111111111111111111111111111111111111
AGENT_PRIVATE_KEY=0x1111111111111111111111111111111111111111111111111111111111111111
VENDOR_API_URL=http://localhost:3000/api/data
PORT=3000
```

README должен содержать:

1. Краткий protocol flow и package APIs.
2. Требования Node 20+, Corepack, Base Sepolia ETH и test USDC.
3. Команды `corepack enable`, `pnpm install`, `cp .env.example .env`, `pnpm build`.
4. Terminal A: `pnpm demo:vendor`; Terminal B: `pnpm demo:agent`.
5. Команды `pnpm test`, `pnpm typecheck`, `pnpm build`.
6. Таблицу chain IDs и официальных USDC addresses со ссылками Circle/Base.
7. Security notes: mainnet real funds, default cap, origin allowlisting responsibility, one-confirmation reorg risk, in-memory replay limits, no secret logging.
8. Пример server/client TypeScript API из утверждённого дизайна.

- [ ] **Step 6: Выполнить полную свежую проверку**

Run:

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
node --input-type=module -e "await import('./packages/server/dist/index.js'); await import('./packages/client/dist/index.js')"
git status --short
```

Expected: все tests PASS; typecheck/build и оба ESM imports exit `0`; status показывает только файлы Task 6 до commit. Проверить `packages/server/dist/index.js`, `packages/server/dist/index.d.ts`, `packages/client/dist/index.js`, `packages/client/dist/index.d.ts`.

- [ ] **Step 7: Закоммитить demo и документацию**

```bash
git add examples .env.example README.md package.json
git commit -m "docs: add Base Sepolia x402 demo"
```

- [ ] **Step 8: Проверить чистое состояние после commit**

Run: `git status --short --branch && git log --oneline -8`

Expected: рабочее дерево чистое; история содержит design, plan, пять feature commits Tasks 1–5 и demo commit Task 6.
