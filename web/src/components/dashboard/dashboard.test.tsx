import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import type { ActionState } from "@/features/gateway/actions";
import type { EndpointSummary } from "@/features/gateway/repository";

import { EndpointDetails } from "./endpoint-details";
import { EndpointForm } from "./endpoint-form";
import { EndpointList } from "./endpoint-list";

const ok = () => Promise.resolve({} as ActionState);

function summary(overrides: Partial<EndpointSummary> = {}): EndpointSummary {
  return {
    id: "endpoint-1",
    publicId: "public-abc",
    ownerId: "owner",
    displayName: "Weather",
    upstreamUrl: "https://api.example.com/weather",
    authMode: "bearer",
    payTo: "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1",
    amountAtomic: "10000",
    payoutPolicy: "threshold_or_weekly",
    status: "draft",
    configVersion: 1,
    secretConfigured: true,
    lastTestStatus: null,
    lastTestHttpStatus: null,
    lastTestResponseSize: null,
    lastTestLatencyMs: null,
    lastTestAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("EndpointList", () => {
  test("shows the empty state when there are no endpoints", () => {
    render(<EndpointList endpoints={[]} />);
    expect(screen.getByText(/no endpoints yet/i)).toBeInTheDocument();
  });

  test("lists endpoints with price and status", () => {
    render(<EndpointList endpoints={[summary(), summary({ status: "active" })]} />);
    expect(screen.getAllByTestId("endpoint-card")).toHaveLength(2);
    expect(screen.getAllByText(/0\.01 USDC per request/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });
});

describe("EndpointForm", () => {
  test("submits the draft and surfaces an action field error", async () => {
    const user = userEvent.setup();
    let received: FormData | null = null;
    const action = async (_: ActionState, formData: FormData): Promise<ActionState> => {
      received = formData;
      return { fieldErrors: { displayName: "Display name is required" } };
    };
    render(<EndpointForm mode="create" existingSecret={false} armed action={action} />);

    await user.type(screen.getByLabelText(/display name/i), "Weather");
    await user.type(screen.getByLabelText(/your https get endpoint/i), "https://api.example.com/weather");
    await user.type(screen.getByLabelText(/base payout address/i), "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1");
    await user.click(screen.getByRole("button", { name: /create draft endpoint/i }));

    expect(received).not.toBeNull();
    expect(received!.get("displayName")).toBe("Weather");
    expect(await screen.findByText("Display name is required")).toBeInTheDocument();
  });

  test("hides the secret field value and marks keep-blank on edit", async () => {
    render(
      <EndpointForm
        mode="edit"
        endpointId="endpoint-1"
        initial={{
          displayName: "Weather",
          upstreamUrl: "https://api.example.com/weather",
          authMode: "bearer",
          price: "0.01",
          payTo: "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1",
        }}
        existingSecret
        armed
        action={ok}
      />,
    );
    expect(screen.getByLabelText(/replace upstream secret/i)).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
  });
});

describe("EndpointDetails", () => {
  test("shows the gateway URL for an active endpoint", () => {
    render(
      <EndpointDetails
        endpoint={summary({ status: "active" })}
        gatewayUrl="https://agentpay.example/g/public-abc"
        recent
        statusAction={ok}
        credentialAction={ok}
        payoutAction={ok}
        payoutPolicyAction={ok}
        priceAction={ok}
        connectivityAction={ok}
      />,
    );
    expect(screen.getByText("https://agentpay.example/g/public-abc")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pause endpoint/i })).toBeInTheDocument();
  });

  test("allows activating a draft and offers an edit link", () => {
    render(
      <EndpointDetails
        endpoint={summary()}
        gatewayUrl="https://agentpay.example/g/public-abc"
        recent={false}
        statusAction={ok}
        credentialAction={ok}
        payoutAction={ok}
        payoutPolicyAction={ok}
        priceAction={ok}
        connectivityAction={ok}
      />,
    );
    expect(screen.getByRole("button", { name: /activate endpoint/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /edit endpoint/i })).toHaveAttribute(
      "href",
      "/dashboard/endpoint-1/edit",
    );
  });

  test("warns when money settings on a live endpoint need a fresh sign-in", () => {
    render(
      <EndpointDetails
        endpoint={summary({ status: "active" })}
        gatewayUrl="https://agentpay.example/g/public-abc"
        recent={false}
        statusAction={ok}
        credentialAction={ok}
        payoutAction={ok}
        payoutPolicyAction={ok}
        priceAction={ok}
        connectivityAction={ok}
      />,
    );
    expect(
      screen.getByText(/live payouts and prices can only change after a fresh sign-in/i),
    ).toBeInTheDocument();
  });

  test("never renders the upstream secret value", () => {
    const withSecret = summary({ secretConfigured: true });
    const { container } = render(
      <EndpointDetails
        endpoint={withSecret}
        gatewayUrl="https://agentpay.example/g/public-abc"
        recent
        statusAction={ok}
        credentialAction={ok}
        payoutAction={ok}
        payoutPolicyAction={ok}
        priceAction={ok}
        connectivityAction={ok}
      />,
    );
    expect(container.innerHTML).not.toContain("secret-token");
  });
});
