export class RefundProcessor {
  issueRefund(invoiceId: string, amountCents: number): boolean {
    return invoiceId.length > 0 && amountCents > 0;
  }
}
