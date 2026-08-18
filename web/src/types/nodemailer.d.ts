declare module "nodemailer" {
  interface Transporter {
    sendMail(message: Record<string, string>): Promise<unknown>;
  }

  interface Nodemailer {
    createTransport(server: string): Transporter;
  }

  const nodemailer: Nodemailer;
  export default nodemailer;
}
