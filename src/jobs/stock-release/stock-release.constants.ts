export const STOCK_RELEASE_QUEUE = 'stock-release';
export const STOCK_RELEASE_JOB = 'release-unpaid-order';

export function getPaymentTimeoutMs(): number {
  const minutes = parseInt(
    process.env.ORDER_PAYMENT_TIMEOUT_MINUTES ?? '15',
    10,
  );
  return minutes * 60 * 1000;
}
