export const formatAmount = (amount: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(amount));

export const Amount = ({ amount, currency = false }: { amount: number; currency?: boolean }) => (
  <span>
    {formatAmount(amount)}
    {currency && ' USD'}
  </span>
);
