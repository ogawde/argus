/** PayPal payout event names observed or documented for the sandbox app. */
export const ITEM_STATUS_BY_EVENT: Record<string, string> = {
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": "SUCCESS",
  "PAYMENT.PAYOUTS-ITEM.FAILED": "FAILED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED": "BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED": "CANCELED",
  "PAYMENT.PAYOUTS-ITEM.DENIED": "DENIED",
  "PAYMENT.PAYOUTS-ITEM.HELD": "PROCESSING",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED": "REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED": "RETURNED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": "UNCLAIMED",
};

export const BATCH_STATUS_BY_EVENT: Record<string, string> = {
  "PAYMENT.PAYOUTSBATCH.PROCESSING": "PROCESSING",
  "PAYMENT.PAYOUTSBATCH.SUCCESS": "SUCCESS",
  "PAYMENT.PAYOUTSBATCH.DENIED": "DENIED",
};

export interface ParsedPayoutEvent {
  eventId: string;
  eventType: string;
  senderItemId: string | null;
  paypalItemId: string | null;
  paypalBatchId: string | null;
  itemStatus: string | null;
  batchStatus: string | null;
}

/** Pull the ids we care about out of a PayPal webhook body. */
export function parsePayoutEvent(body: unknown): ParsedPayoutEvent | null {
  if (!body || typeof body !== "object") return null;
  const event = body as {
    id?: string;
    event_type?: string;
    resource?: {
      payout_item_id?: string;
      transaction_status?: string;
      payout_batch_id?: string;
      sender_item_id?: string;
      payout_item?: { sender_item_id?: string };
      batch_header?: { payout_batch_id?: string; batch_status?: string };
    };
  };
  if (!event.id || !event.event_type) return null;
  const resource = event.resource ?? {};
  return {
    eventId: event.id,
    eventType: event.event_type,
    senderItemId: resource.payout_item?.sender_item_id ?? resource.sender_item_id ?? null,
    paypalItemId: resource.payout_item_id ?? null,
    paypalBatchId: resource.payout_batch_id ?? resource.batch_header?.payout_batch_id ?? null,
    itemStatus: ITEM_STATUS_BY_EVENT[event.event_type] ?? resource.transaction_status ?? null,
    batchStatus: BATCH_STATUS_BY_EVENT[event.event_type] ?? resource.batch_header?.batch_status ?? null,
  };
}
