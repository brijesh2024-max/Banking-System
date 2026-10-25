import nodemailer from 'nodemailer';

export function createReceipts(config) {
  if (!config.smtpHost) return async () => {};
  const transport = nodemailer.createTransport({
    host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure,
    requireTLS: !config.smtpSecure, tls: { minVersion: 'TLSv1.2' },
    disableFileAccess: true, disableUrlAccess: true,
    connectionTimeout: 10000, socketTimeout: 15000,
    ...(config.smtpUser ? { auth: { user: config.smtpUser, pass: config.smtpPass } } : {}),
  });
  return async (user, transaction) => {
    try {
      await transport.sendMail({ from: config.smtpFrom, to: user.email, subject: `Vault receipt: ${transaction.reference}`, text: `Hello ${user.name},\n\nYour ${transaction.type} of INR ${(transaction.amountPaise / 100).toFixed(2)} is complete.\nRecipient: ${transaction.to.name}\nReference: ${transaction.reference}\n\nThis is an internal portfolio application transaction, not an external bank payment.` });
    } catch {
      // Receipts are best effort; email delivery must never undo committed funds.
      console.warn('[email] Receipt delivery failed for transaction', transaction.id);
    }
  };
}
