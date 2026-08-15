import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

const BASE_NETWORK = "eip155:8453";

export interface FacilitatorApi {
  getSupported(): unknown;
  verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse>;
  settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse>;
}

export interface FacilitatorAppOptions {
  facilitator: FacilitatorApi;
  healthcheck: () => Promise<boolean>;
}

interface FacilitatorRequestBody {
  x402Version: 2;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequestBody(value: unknown): FacilitatorRequestBody | undefined {
  if (!isObject(value) || value.x402Version !== 2) {
    return undefined;
  }
  if (!isObject(value.paymentPayload) || !isObject(value.paymentRequirements)) {
    return undefined;
  }
  return value as unknown as FacilitatorRequestBody;
}

function privateJson(response: Response, status: number, body: unknown): void {
  response.setHeader("Cache-Control", "private, no-store");
  response.status(status).json(body);
}

export function createFacilitatorApp(options: FacilitatorAppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb", strict: true }));

  app.get("/healthz", async (_request, response) => {
    try {
      if (await options.healthcheck()) {
        privateJson(response, 200, { status: "ok", network: BASE_NETWORK });
        return;
      }
    } catch {
      // Health failures are intentionally opaque.
    }
    privateJson(response, 503, { status: "unavailable" });
  });

  app.get("/supported", (_request, response) => {
    try {
      privateJson(response, 200, options.facilitator.getSupported());
    } catch {
      privateJson(response, 500, { error: "facilitator_error" });
    }
  });

  const delegate =
    (operation: "verify" | "settle") => async (request: Request, response: Response) => {
      const body = parseRequestBody(request.body);
      if (!body) {
        privateJson(response, 400, { error: "invalid_request" });
        return;
      }

      try {
        const result = await options.facilitator[operation](
          body.paymentPayload,
          body.paymentRequirements,
        );
        privateJson(response, 200, result);
      } catch {
        privateJson(response, 500, { error: "facilitator_error" });
      }
    };

  app.post("/verify", delegate("verify"));
  app.post("/settle", delegate("settle"));

  app.use((_request, response) => {
    privateJson(response, 404, { error: "not_found" });
  });

  app.use((
    _error: unknown,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    privateJson(response, 400, { error: "invalid_request" });
  });

  return app;
}
