# Full x402 v1 Rollback Design

## Goal

Restore the entire repository to the last state before the x402 v2 migration,
commit `03c7c26`, instead of selectively porting v1 onto the newer production
stack.

## Scope

- The final tracked tree must match commit `03c7c26` exactly.
- Restore the custom x402 v1 client and server implementation.
- Restore the v1 `X-Payment-Tx` request flow and on-chain Base receipt
  verification.
- Remove all files and behavior introduced after `03c7c26`, including the CDP
  facilitator integration, v2 payment headers, v2 idempotency implementation,
  later production Compose split, and later deployment documentation.
- Do not rewrite existing Git history. Record the rollback as a new commit.
- Do not copy or deploy buyer private keys.

## Execution

Restore the index and worktree from `03c7c26`, verify that `git diff` against
that commit is empty, install the restored lockfile dependencies if necessary,
and run the v1 test, typecheck, lint, and build commands. Commit the resulting
tree as a single explicit rollback commit.

The production server is not changed until the restored v1 tree passes local
verification. Deployment then uses the deployment mechanism that exists in the
restored tree, with a backup of the current server state before replacement.

## Success Criteria

- `git diff --exit-code 03c7c26 -- .` succeeds after the rollback commit.
- The restored v1 unit tests, typecheck, lint, and production build pass.
- An unpaid premium request exposes the original v1 response contract.
- A v1 client can submit `X-Payment-Tx`; no CDP facilitator credentials or x402
  v2 headers are required.
