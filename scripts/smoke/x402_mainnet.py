"""Guarded, clean-room x402 v2 Base Mainnet buyer using the official Python SDK."""

from __future__ import annotations

import base64
import json
import os
import re
import sys
from typing import Any
from urllib.parse import urlparse

import requests
from eth_account import Account
from x402 import x402ClientSync
from x402.http import x402HTTPClientSync
from x402.http.clients import x402_requests
from x402.mechanisms.evm import EthAccountSigner
from x402.mechanisms.evm.exact.register import register_exact_evm_client

DEFAULT_API_URL = "https://agentpay.thebestsites.ru/api/premium"
BASE_NETWORK = "eip155:8453"
BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
AGENTPAY_PAY_TO = "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB"
MAX_AMOUNT = 10_000
MAX_TIMEOUT_SECONDS = 300


def reject() -> None:
    """Raise a stable policy error without echoing untrusted payment terms."""
    raise ValueError("payment_policy_rejected")


def canonical_api_url(value: str) -> str:
    """Allow HTTPS, plus explicit loopback HTTP for controlled local smoke tests."""
    parsed = urlparse(value)
    loopback = parsed.scheme == "http" and parsed.hostname in {
        "localhost", "127.0.0.1", "::1"
    }
    if parsed.scheme != "https" and not loopback:
        reject()
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        reject()
    return value


def decode_payment_required(encoded: str) -> dict[str, Any]:
    """Decode the canonical x402 v2 header without accepting body fallbacks."""
    try:
        padding = "=" * (-len(encoded) % 4)
        value = json.loads(base64.b64decode(encoded + padding).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        reject()
    if not isinstance(value, dict):
        reject()
    return value


def validate_payment_required(encoded: str, api_url: str) -> dict[str, Any]:
    """Enforce the exact AgentPay origin, asset, amount, payee, and timeout cap."""
    payment = decode_payment_required(encoded)
    accepts = payment.get("accepts")
    resource = payment.get("resource")
    extensions = payment.get("extensions", {})
    if (
        payment.get("x402Version") != 2
        or not isinstance(resource, dict)
        or resource.get("url") != canonical_api_url(api_url)
        or not isinstance(accepts, list)
        or len(accepts) != 1
        or extensions != {}
    ):
        reject()
    accepted = accepts[0]
    if not isinstance(accepted, dict):
        reject()
    try:
        allowed = (
            accepted.get("scheme") == "exact"
            and accepted.get("network") == BASE_NETWORK
            and int(accepted.get("amount", "-1")) == MAX_AMOUNT
            and str(accepted.get("asset", "")).lower() == BASE_USDC.lower()
            and str(accepted.get("payTo", "")).lower() == AGENTPAY_PAY_TO.lower()
            and 1 <= int(accepted.get("maxTimeoutSeconds", 0)) <= MAX_TIMEOUT_SECONDS
        )
    except (TypeError, ValueError):
        allowed = False
    if not allowed:
        reject()
    return {
        "resource": api_url,
        "network": BASE_NETWORK,
        "amount": "10000",
        "amountUsdc": "0.01",
        "asset": BASE_USDC,
        "payTo": AGENTPAY_PAY_TO,
        "maxTimeoutSeconds": int(accepted["maxTimeoutSeconds"]),
    }


def load_private_key() -> str:
    """Read but never print the dedicated buyer key."""
    value = os.environ.get("AGENT_PRIVATE_KEY", "")
    if not re.fullmatch(r"0x[0-9a-fA-F]{64}", value) or int(value, 16) == 0:
        raise ValueError("AGENT_PRIVATE_KEY_invalid")
    return value


def main() -> None:
    """Preview safely; pay only when both irreversible-action gates are present."""
    api_url = canonical_api_url(os.environ.get("API_URL", DEFAULT_API_URL))
    quote = requests.get(
        api_url,
        headers={"Accept": "application/json"},
        allow_redirects=False,
        timeout=30,
    )
    if quote.status_code != 402 or "PAYMENT-REQUIRED" not in quote.headers:
        raise RuntimeError("payment_preview_failed")
    payment = validate_payment_required(quote.headers["PAYMENT-REQUIRED"], api_url)
    print(json.dumps({"mode": "preview", "payment": payment}, separators=(",", ":")))

    execute = "--execute" in sys.argv[1:]
    if not execute or os.environ.get("ALLOW_MAINNET_PAYMENTS") != "true":
        print("PAYMENT NOT SENT")
        return

    account = Account.from_key(load_private_key())
    client = x402ClientSync()
    register_exact_evm_client(client, EthAccountSigner(account))
    http_client = x402HTTPClientSync(client)
    with x402_requests(client) as session:
        response = session.get(
            api_url,
            headers={"Accept": "application/json"},
            allow_redirects=False,
            timeout=150,
        )
        if not response.ok:
            raise RuntimeError("paid_request_failed")
        settlement = http_client.get_payment_settle_response(response.headers.get)
        if not settlement.success or not settlement.transaction:
            raise RuntimeError("settlement_failed")
        print(json.dumps({
            "status": response.status_code,
            "transaction": settlement.transaction,
            "data": response.json(),
        }, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("AgentPay x402 smoke failed", file=sys.stderr)
        raise SystemExit(1)
