export interface PayoutChangeNotification {
  readonly recipient: string;
  readonly endpointName: string;
  readonly payTo: string;
}

export interface EmailConfiguration {
  readonly server: string;
  readonly from: string;
}

export interface MailTransport {
  sendMail(message: Record<string, string>): Promise<unknown>;
}

export async function sendPayoutChangeNotification(
  notification: PayoutChangeNotification,
  configuration: EmailConfiguration,
  transportFactory: (server: string) => MailTransport = server =>
    nodemailer.createTransport(server),
): Promise<void> {
  const transport = transportFactory(configuration.server);
  await transport.sendMail({
    from: configuration.from,
    to: notification.recipient,
    subject: "AgentPay payout address changed",
    text: [
      `The payout address for ${notification.endpointName} was changed.`,
      `New address: ${notification.payTo}`,
      "If you did not make this change, pause the endpoint and contact AgentPay immediately.",
    ].join("\n\n"),
  });
}
import nodemailer from "nodemailer";
