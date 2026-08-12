# Безопасный mainnet-режим для x402 USDC demo

> Superseded by the [x402 v2 migration](../plans/2026-08-12-x402-v2-migration.md). Retained as v1 design history.

Дата: 2026-08-03
Статус: утверждён пользователем

## 1. Цель

Добавить в существующий x402 USDC SDK отдельный демонстрационный режим для
реального перевода `0.01 USDC` в Base Mainnet. Режим должен быть fail-closed:
ошибка конфигурации, несовпадение сети, цены, получателя, URL или баланса не
должны приводить к подписанию транзакции.

Существующий Base Sepolia demo остаётся поведением по умолчанию и не может
переключиться в mainnet только из-за значения переменной окружения.

## 2. Границы задачи

В задачу входят:

- отдельные команды запуска Base Mainnet demo;
- общий валидатор конфигурации для Base Sepolia и Base Mainnet;
- явное разрешение mainnet через окружение;
- двухэтапный mainnet-поток `preflight -> execute`;
- проверка публичных балансов и оценка gas перед возможной отправкой;
- точная политика оплаты для сети, цены, получателя и origin;
- немедленный вывод transaction hash после отправки;
- автоматические тесты без обращения к реальной сети и без расходования средств;
- обновление `.env.example` и README.

В задачу не входят:

- автоматический запуск реальной транзакции во время разработки или тестов;
- production-развёртывание Vendor API;
- поддержка удалённого mainnet Vendor API;
- persistent replay store, refunds или восстановление после ошибки downstream
  handler;
- изменение wire-протокола HTTP 402;
- повышение фиксированной цены выше `0.01 USDC`;
- публикация пакетов в npm.

## 3. Выбранный подход

Используются отдельные package scripts поверх общей реализации:

```sh
pnpm demo:vendor
pnpm demo:agent
pnpm demo:vendor:mainnet
pnpm demo:agent:mainnet
pnpm demo:agent:mainnet -- --execute
```

Первые две команды всегда запускают Base Sepolia и игнорируют любые
переданные флаги выбора сети. Mainnet-команды запускают отдельные тонкие
entrypoint-файлы, которые явно выбирают Base Mainnet перед вызовом общей
реализации; публичного аргумента переключения сети нет. Произвольный
`CHAIN_ID` из окружения не используется.

Такой подход выбран вместо единственной команды с `X402_CHAIN_ID`, потому что
ошибка в `.env` или forwarded CLI-флаг не должны незаметно изменить testnet на
mainnet. Mainnet-файлы содержат только выбор режима и вызов общей логики, чтобы
testnet и mainnet не расходились по бизнес-логике и исправлениям.

## 4. Конфигурация

`.env.example` сохраняет существующие поля и добавляет:

```dotenv
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_MAINNET_RPC_URL=https://mainnet.base.org
ALLOW_MAINNET_PAYMENTS=false
VENDOR_WALLET_ADDRESS=0x1111111111111111111111111111111111111111
AGENT_PRIVATE_KEY=0x1111111111111111111111111111111111111111111111111111111111111111
VENDOR_API_URL=http://127.0.0.1:3000/api/data
PORT=3000
```

Правила:

- Base Sepolia читает только `BASE_SEPOLIA_RPC_URL`.
- Base Mainnet читает только `BASE_MAINNET_RPC_URL`.
- Mainnet Vendor API и выполнение mainnet-платежа требуют точного значения
  `ALLOW_MAINNET_PAYMENTS=true`.
- Отсутствующее, пустое или отличающееся значение трактуется как запрет.
- Цена не читается из окружения: для обоих demo она зафиксирована в коде как
  `0.01 USDC`.
- Mainnet cap агента равен цене: `0.01 USDC`.
- Private key никогда не печатается, не включается в ошибки и не передаётся в
  callback политики.

## 5. Сетевая модель

Используется статический реестр:

| Режим | Network | Chain ID | RPC env | USDC |
| --- | --- | ---: | --- | --- |
| Testnet | `base-sepolia` | 84532 | `BASE_SEPOLIA_RPC_URL` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Mainnet | `base` | 8453 | `BASE_MAINNET_RPC_URL` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

Mainnet Vendor API слушает только `127.0.0.1`. Mainnet Agent принимает
`VENDOR_API_URL` только в точной локальной форме
`http://127.0.0.1:<PORT>/api/data`: protocol, hostname, port и pathname должны
совпасть, а credentials, query и fragment запрещены. Запрос выполняется с
`redirect: "error"`, поэтому HTTP redirect не может изменить получателя
платёжных требований.

Testnet сохраняет существующий локальный сценарий и совместимость текущих
команд.

## 6. Изменения клиентского API

В `AgentFetchConfig` добавляется необязательная асинхронная политика:

```ts
authorizePayment?: (
  context: PaymentAuthorizationContext,
) => boolean | Promise<boolean>;
```

Контекст только для чтения содержит:

- исходный request URL;
- chain ID и network из проверенного 402;
- нормализованный `payTo`;
- официальный USDC token address;
- исходную строку цены и сумму в минимальных единицах USDC.

Callback вызывается после синтаксической и семантической проверки 402, но до
создания payment runtime, RPC chain check и `transferUsdc`. Значение `false`
приводит к `X402ProtocolError` с новым кодом `payment_not_authorized`. Если
callback бросает исключение, оно оборачивается в тот же тип ошибки с `cause`.
Без callback поведение клиента полностью совместимо с текущим.

Также добавляется необязательный callback:

```ts
onTransactionSubmitted?: (
  context: PaymentTransactionContext,
) => void | Promise<void>;
```

Он вызывается сразу после получения transaction hash и до ожидания receipt и
повторного HTTP-запроса. Контекст содержит hash, chain ID, token, получателя и
сумму. Mainnet demo использует callback для немедленного вывода hash и ссылки
на Base explorer.

Ошибка observability callback не должна прекращать уже начатый необратимый
платёжный поток. Клиент продолжает ждать receipt и выполнять retry; demo
callback ограничивается синхронным выводом в консоль.

## 7. Mainnet preflight и авторизация

`pnpm demo:agent:mainnet` получает настоящий HTTP 402 от локального Vendor API,
но политика оплаты возвращает запрет, если отсутствует `--execute`. До этого
она выполняет preflight и печатает только публичные данные.

Preflight проверяет:

1. `VENDOR_API_URL` является loopback URL и redirect запрещён.
2. RPC отвечает chain ID `8453`.
3. 402 содержит `network: "base"` и `chainId: 8453`.
4. Цена в integer USDC units строго равна `10_000` (`0.01 USDC`).
5. `payTo` адресно совпадает с `VENDOR_WALLET_ADDRESS`.
6. Token совпадает с официальным Base USDC.
7. Публичный USDC balance агента не меньше `10_000` units.
8. ETH balance агента положителен.
9. RPC может симулировать `USDC.transfer(payTo, 10_000)` от адреса агента.
10. RPC может оценить gas и верхнюю fee per gas. Требуемый запас рассчитывается
    как `estimatedGas * upperFeePerGas * 2`; ETH balance должен быть не меньше
    этой величины. Двукратный множитель является фиксированным запасом demo, а
    оценка остаётся preflight-проверкой, не гарантией будущей цены gas.

Вывод включает:

- пометку `BASE MAINNET / REAL FUNDS`;
- публичный agent address;
- Vendor API URL;
- chain ID;
- recipient;
- USDC token;
- точную цену;
- ETH и USDC balances;
- оценку gas;
- итог `PAYMENT NOT SENT` без `--execute`.

Private key и полное содержимое `.env` не выводятся.

## 8. Условия реальной отправки

Политика возвращает разрешение только если одновременно выполнены все условия:

1. Запущен script `demo:agent:mainnet`.
2. Все preflight-проверки успешны.
3. Передан аргумент `--execute`.
4. `ALLOW_MAINNET_PAYMENTS` имеет точное значение `true`.

Отсутствие любого условия завершает процесс без вызова `transferUsdc`.

Перед отправкой demo повторно печатает chain, recipient и точную сумму. После
отправки немедленно печатает transaction hash и explorer URL. Поэтому ошибка
при ожидании receipt или HTTP retry не скрывает факт возможного списания.

После hash demo выводит предупреждение не перезапускать команду до проверки
транзакции в explorer.

## 9. Vendor API

`createVendorApp` принимает явную сетевую конфигурацию вместо hardcoded
Sepolia. Для ответа paid handler используется network из той же конфигурации,
поэтому payload и бизнес-ответ не могут расходиться.

Testnet command использует Sepolia-конфигурацию. Mainnet command использует
Base-конфигурацию и отказывается стартовать без `ALLOW_MAINNET_PAYMENTS=true`.

Mainnet startup banner показывает:

- `BASE MAINNET / REAL FUNDS`;
- endpoint;
- цену `0.01 USDC`;
- recipient;
- предупреждение об in-memory replay store и отсутствии refund.

## 10. Ошибки и завершение процесса

- Ошибка конфигурации происходит до запуска сервера или создания кошелька.
- Preflight failure завершает mainnet agent с ненулевым кодом и без transfer.
- Успешный preview без `--execute` завершает процесс с кодом `0` и сообщением
  `PAYMENT NOT SENT`.
- `--execute` без `ALLOW_MAINNET_PAYMENTS=true` завершается с ненулевым кодом
  до transfer.
- Policy rejection никогда не создаёт payment runtime.
- После получения hash любая последующая ошибка сообщает, что транзакцию нужно
  проверить по уже напечатанному hash до повторного запуска.
- Секреты не включаются в сообщения об ошибках.

## 11. Тестирование

Все автоматические тесты используют mocks и dependency injection. Mainnet RPC
и реальный private key не используются.

Добавляются проверки:

### Demo configuration

- существующие команды выбирают Base Sepolia;
- mainnet-команды выбирают Base Mainnet;
- произвольное значение env не меняет выбранный script mode;
- некорректные RPC URL, address, port и opt-in отклоняются;
- mainnet URL обязан быть loopback;
- mainnet Vendor API не стартует без opt-in.

### Client policy

- callback получает нормализованный проверенный контекст;
- `false`, synchronous throw и rejected promise блокируют payment runtime;
- разрешение продолжает существующий transfer flow;
- отсутствие callback сохраняет старое поведение;
- transaction callback получает hash до `waitForReceipt`;
- ошибка transaction callback не прерывает подтверждение и retry.

### Mainnet preflight

- preview не вызывает transfer;
- `--execute` без opt-in не вызывает transfer;
- неверные chain, network, price, recipient, token или origin блокируют transfer;
- недостаточный USDC или ETH блокирует transfer;
- failed simulation или gas estimate блокируют transfer;
- успешные проверки плюс два opt-in разрешают ровно один transfer;
- логи не содержат private key.

### Regression verification

Обязательные команды:

```sh
pnpm test
pnpm typecheck
pnpm build
```

Дополнительно выполняются import smoke-проверки собранных ESM entry points и
read-only запуск mainnet preview с mock/local dependencies. Команда с
`--execute` против реального RPC не запускается.

## 12. Документация пользователя

README получает отдельные разделы:

- неизменённый Base Sepolia demo;
- подготовка выделенного low-balance mainnet wallet;
- требование одновременно иметь Base USDC и Base ETH;
- безопасный mainnet preflight;
- точная команда execute;
- проверка 402 перед execute;
- действия при ошибке после transaction hash;
- ограничение loopback demo;
- предупреждения про in-memory replay и отсутствие refunds.

## 13. Критерии готовности

Работа готова, когда:

- Base Sepolia остаётся безопасным поведением существующих команд;
- mainnet невозможно выбрать только через chain ID в `.env`;
- preview получает и проверяет 402, но не создаёт транзакцию;
- mainnet transfer требует mainnet script, успешный preflight, `--execute` и
  `ALLOW_MAINNET_PAYMENTS=true`;
- mainnet цена и cap равны `0.01 USDC`;
- неверные origin, recipient, chain, token, price или balances блокируют оплату;
- hash печатается до ожидания receipt/retry;
- private key никогда не печатается;
- все автоматические тесты, typecheck, build и ESM import smoke проходят;
- ни одна проверка разработки не расходует реальные или тестовые средства.
