# Дизайн HTTP 402 Micropayment SDK для USDC в Base

> Superseded by the [x402 v2 migration](../plans/2026-08-12-x402-v2-migration.md). Retained as v1 design history.

Дата: 2026-08-02  
Статус: утверждён пользователем

## 1. Цель и границы

Нужно создать минимальный production-ready TypeScript-монорепозиторий для оплаты API-вызовов AI-агентами через HTTP 402 и ERC-20 USDC в сетях Base. Первая версия включает:

- `@x402/server`: независимый verifier и Express middleware;
- `@x402/client`: совместимую с `fetch` обёртку, которая выполняет один USDC-платёж и один повтор запроса;
- `examples`: Express Vendor API и AI Agent клиент для Base Sepolia;
- автоматические unit/integration-style тесты без расходования реальных средств;
- README, `.env.example`, строгую TypeScript-сборку и воспроизводимые команды `pnpm`.

Первая версия не включает Hono-адаптер, базу данных, распределённый replay-store, возвраты платежей, gas sponsorship, smart accounts, подписки, мультичейн за пределами Base и публикацию пакетов в npm. Verifier отделяется от Express, поэтому Hono-адаптер можно добавить без изменения протокола.

## 2. Подтверждённые параметры сетей

SDK поддерживает только следующие сети и официальные контракты USDC с 6 знаками после запятой:

| Сеть | Chain ID | Имя протокола | USDC |
| --- | ---: | --- | --- |
| Base Mainnet | 8453 | `base` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | 84532 | `base-sepolia` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

Источники: [Circle — USDC Contract Addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses) и [Base — Connecting to Base](https://docs.base.org/base-chain/quickstart/connecting-to-base). Публичные RPC Base пригодны для демо, но документация Base прямо рекомендует отдельного RPC-провайдера для production.

## 3. Структура workspace

```text
.
├── packages/
│   ├── server/
│   │   ├── src/
│   │   │   ├── middleware.ts
│   │   │   ├── verifier.ts
│   │   │   └── index.ts
│   │   ├── test/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── client/
│       ├── src/
│       │   ├── agentFetch.ts
│       │   └── index.ts
│       ├── test/
│       ├── package.json
│       └── tsconfig.json
├── examples/
│   ├── vendor-api.ts
│   └── ai-agent.ts
├── docs/superpowers/specs/
├── .env.example
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

Монорепозиторий использует strict TypeScript, ES Modules, Node.js 20+, `pnpm`, `viem`, Express, Vitest и `tsx`. Пакеты компилируются `tsc` в `dist` и публикуют типизированные ESM exports без дополнительного bundler-слоя.

## 4. Серверный пакет

### 4.1 Публичный API

Основной API:

```ts
paymentMiddleware({
  priceUsdc: "0.01",
  payTo: "0xVendor...",
  chainId: 84532,
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL,
});
```

Экспортируемые типы включают `PaymentMiddlewareOptions`, `PaymentRequirements`, `SupportedChainId`, `PaymentVerifier`, `PaymentVerificationResult` и `ReplayStore`. Для тестов и расширения verifier можно создать отдельно и передать в middleware. Значения `usdcAddress`, `publicClient`, `confirmations` и `replayStore` допускают явное dependency injection; обычному пользователю достаточно четырёх полей из примера.

Конфигурация валидируется при создании middleware:

- `priceUsdc` — положительная десятичная строка с максимум 6 знаками;
- `payTo` — валидный EVM address;
- `chainId` — только `8453` или `84532`;
- `rpcUrl` должен присутствовать, если не передан готовый public client;
- `confirmations` — положительное целое, по умолчанию `1`.

### 4.2 Ответ 402

Если `X-Payment-Tx` отсутствует, middleware возвращает:

```json
{
  "error": "Payment Required",
  "priceUsdc": "0.01",
  "payTo": "0xVendorWalletAddress...",
  "network": "base-sepolia",
  "chainId": 84532
}
```

Content-Type устанавливается в `application/json`. Заголовки HTTP обрабатываются без учёта регистра.

### 4.3 Верификация платежа

При наличии `X-Payment-Tx` verifier:

1. Проверяет формат 32-байтового transaction hash.
2. Запрашивает receipt через `viem` public client.
3. Проверяет `receipt.status === "success"`.
4. Проверяет требуемое число подтверждений по высоте последнего блока.
5. Рассматривает только логи, эмитированные настроенным контрактом USDC.
6. Декодирует ERC-20 `Transfer(address,address,uint256)` и суммирует переводы на `payTo` в рамках receipt.
7. Сравнивает сумму с `parseUnits(priceUsdc, 6)`; переплата допустима.
8. После успешной on-chain проверки атомарно резервирует ключ `<chainId>:<txHash>` в replay-store.

Поле `transaction.to` не сравнивается с адресом продавца: для ERC-20 прямой вызов адресован контракту токена, а фактический получатель и сумма подтверждаются событием `Transfer`. Фильтрация по адресу официального USDC исключает события поддельного токена.

Replay-store по умолчанию — общий для процесса in-memory `Set`. Операция `claim(key)` синхронно выполняет check-and-add, поэтому два параллельных запроса не могут успешно использовать один hash. Интерфейс можно заменить внешним атомарным хранилищем в последующей версии; текущий store очищается при рестарте и не координируется между несколькими процессами.

### 4.4 Статусы ошибок

- отсутствующий заголовок: `402 Payment Required`;
- некорректный hash, неизвестная/неуспешная транзакция, недостаточная сумма, неверный получатель/токен, недостаточно подтверждений или replay: `403 Forbidden` с коротким машинно-читаемым reason;
- временная недоступность RPC или неожиданная ошибка верификации: `503 Service Unavailable`;
- неверная конфигурация middleware: синхронная ошибка при старте приложения.

После успешного `claim` транзакция считается использованной даже если downstream handler завершится ошибкой: on-chain перевод уже необратимо выполнен, а автоматический refund не входит в протокол.

## 5. Клиентский пакет

### 5.1 Публичный API

```ts
const agentFetch = createAgentFetch({
  privateKey: process.env.AGENT_PRIVATE_KEY,
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL,
  maxPaymentUsdc: "1.00",
});

const response = await agentFetch(url, init);
```

Возвращаемая функция имеет fetch-подобную сигнатуру `(input, init) => Promise<Response>`. `privateKey` и `rpcUrl` обязательны. Дополнительные параметры: `maxPaymentUsdc` (по умолчанию `"1.00"`) и `confirmations` (по умолчанию `1`). Пакет экспортирует типы конфигурации и типизированные ошибки протокола/платежа.

### 5.2 Поток клиента

1. Конфигурация и private key валидируются без логирования секрета.
2. Из входа создаётся канонический `Request`; его clones используются для первой отправки и retry, включая методы с body.
3. Любой ответ, кроме `402`, возвращается без изменений.
4. Для `402` JSON строго валидируется: обязательные поля, поддерживаемый chain ID, согласованное имя сети, корректный `payTo`, положительная цена с максимум 6 знаками.
5. Цена сравнивается с `maxPaymentUsdc` в integer USDC units, без floating point.
6. `eth_chainId` переданного RPC обязан совпасть с chain ID из 402 до подписания транзакции.
7. Клиент выбирает официальный USDC из статического реестра, вызывает `transfer(payTo, amount)` через `viem`, затем `waitForTransactionReceipt` с требуемым числом подтверждений.
8. При успешном receipt исходный запрос повторяется один раз с сохранёнными headers и `X-Payment-Tx: <hash>`.
9. Ответ повторного запроса возвращается как есть, включая повторный `402`; второй платёж никогда не выполняется.

Malformed 402, превышение лимита, unsupported chain, RPC mismatch, failed receipt и ошибка перевода приводят к типизированной ошибке. Обычные fetch/network errors сохраняют стандартное поведение платформы.

## 6. Демо

`examples/vendor-api.ts` запускает Express-сервер на `PORT` (по умолчанию `3000`) и защищает `GET /api/data` ценой `0.01` USDC в Base Sepolia. Кошелёк продавца и RPC берутся из окружения.

`examples/ai-agent.ts` создаёт `agentFetch`, вызывает `VENDOR_API_URL` (по умолчанию `http://localhost:3000/api/data`) и печатает только статус и JSON-результат. Private key берётся из `.env` и никогда не выводится.

`.env.example` описывает `BASE_SEPOLIA_RPC_URL`, `VENDOR_WALLET_ADDRESS`, `AGENT_PRIVATE_KEY`, `VENDOR_API_URL` и `PORT`. `.env` игнорируется Git. README предупреждает, что агенту нужны тестовые ETH для gas и тестовые USDC, а mainnet использует реальные средства.

## 7. Тестирование

Тесты используют dependency injection и mocks, поэтому не зависят от публичного RPC и не совершают платежей.

### Verifier

- успешный USDC Transfer с точной суммой и переплатой;
- суммирование нескольких подходящих Transfer-логов;
- failed receipt и недостаточное число подтверждений;
- лог другого токена;
- другой получатель;
- недостаточная сумма;
- malformed/unknown hash;
- последовательный и параллельный replay.

### Express middleware

- `402` payload без заголовка;
- успешный вызов `next()`;
- `403` для невалидного платежа;
- `503` при сбое RPC/verifier.

### Agent fetch

- прозрачный возврат обычного ответа;
- полный поток `402 → transfer → confirmation → retry`;
- сохранение метода, body и headers;
- malformed 402;
- превышение `maxPaymentUsdc`;
- unsupported chain и несогласованное имя сети;
- RPC chain mismatch;
- failed transfer/receipt;
- отсутствие второго платежа при повторном `402`.

Обязательные проверки перед завершением: `pnpm test`, `pnpm typecheck`, `pnpm build`. Также выполняется smoke-проверка запуска vendor API без обращения к реальной сети до получения платёжного hash.

## 8. Критерии готовности

Работа завершена, когда:

- оба пакета собираются как strict ESM TypeScript и имеют корректные exports;
- Express endpoint отвечает специфицированным 402, принимает валидный подтверждённый USDC receipt и блокирует replay;
- клиент автоматически выполняет ограниченный USDC-платёж и ровно один retry;
- Base Mainnet и Base Sepolia используют проверенные официальные параметры;
- тесты покрывают положительный поток, ошибки и ключевые security boundaries;
- README содержит команды установки, сборки и раздельного запуска обоих demo-процессов;
- секреты и build artifacts не попадают в Git.

## 9. Ограничения MVP и развитие

In-memory replay protection соответствует заданному MVP, но для горизонтального масштабирования потребуется атомарный Redis/SQL store. Один confirmation оставляет небольшой reorg-риск; обе стороны могут настроить больше подтверждений. Автоматическая оплата доверяет 402 payload в пределах локального price cap, поэтому production-агенты должны дополнительно ограничивать вызываемые origin на уровне своего приложения. Следующие независимые расширения: Hono adapter, persistent replay-store, allowlist/callback payment policy и стандартизированная идентификация ресурса/платежа.
