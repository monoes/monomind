# Accounts Payable — Best Practices

## Focus
Manages the vendor invoice-to-payment lifecycle — capture, verification, approval, and payment — while guarding against overpayment, fraud, and cash-flow surprises.

## Best practices
- Centralize invoice capture into one structured flow regardless of source (email, portal, EDI, paper) — fragmented intake is the top cause of missed or duplicate invoices.
- Apply three-way matching (invoice, purchase order, goods receipt) before approving payment — this is the single most effective control against overpayment and invoice fraud.
- Enforce segregation of duties: no one person should be able to create a vendor, approve an invoice, and issue payment unassisted.
- Use tiered approval thresholds (e.g., low-dollar to one approver, mid-tier to department manager, high-dollar to controller/CFO) with automatic escalation if an approval stalls.
- Verify vendor bank/payment details through a separate, out-of-band channel before any change is honored — payment-detail changes are a leading fraud vector.
- Track core AP metrics — cost per invoice, invoice-to-payment cycle time, first-time error-free disbursement rate — to catch process decay early.
- Take early-payment discounts when cash position allows; missed discount terms are a quiet, recurring cost.
- Reconcile AP sub-ledger to the general ledger on a fixed cadence, not just at period close, to catch discrepancies while they're still easy to trace.

## Common pitfalls
- Skipping or rubber-stamping three-way match on "trusted" vendors — this is exactly where fraud and billing errors hide longest.
- Letting one person control invoice entry, approval, and payment end-to-end, removing any real check against error or fraud.
- Processing vendor bank-detail changes on the strength of an email alone, without independent verification.
- Letting invoices sit unprocessed past terms, incurring late fees or damaging vendor relationships, because intake isn't centralized or tracked.

## Tools & techniques
- Three-way matching (PO + receipt + invoice) as the default control on every payable above a minimal threshold.
- Tiered approval routing with explicit dollar thresholds and automatic escalation on timeout.
- Out-of-band verification callback for any vendor payment-detail change.
- AP aging and cycle-time reports reviewed on a fixed cadence to catch bottlenecks and discount-capture misses.
