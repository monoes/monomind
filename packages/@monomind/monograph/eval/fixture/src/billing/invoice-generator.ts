export interface Invoice {
  id: string;
  totalCents: number;
}
export function generateInvoice(customerId: string, totalCents: number): Invoice {
  return { id: `inv-${customerId}`, totalCents };
}
