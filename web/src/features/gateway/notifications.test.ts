import { describe, expect, it, vi } from "vitest";

import { sendPayoutChangeNotification } from "./notifications";

describe("sendPayoutChangeNotification", () => {
  it("notifies the verified seller without including upstream credentials", async () => {
    const sendMail = vi.fn(async () => ({ accepted: ["seller@example.test"] }));

    await sendPayoutChangeNotification(
      {
        recipient: "seller@example.test",
        endpointName: "Weather API",
        payTo: "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1",
      },
      {
        server: "smtp://mail.example.test:587",
        from: "AgentPay <agentpay@example.test>",
      },
      () => ({ sendMail }),
    );

    expect(sendMail).toHaveBeenCalledWith({
      from: "AgentPay <agentpay@example.test>",
      to: "seller@example.test",
      subject: "AgentPay payout address changed",
      text: expect.stringContaining("0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1"),
    });
    expect(JSON.stringify(sendMail.mock.calls)).not.toContain("credential");
  });
});
