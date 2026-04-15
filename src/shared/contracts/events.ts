// src/shared/contracts/events.ts
//
// Typed event schemas for Kafka topics.
// Every Kafka message.value must conform to one of these interfaces.
// Topic naming convention: {domain}.{entity}-{past-tense-verb}
//
// Consumers use:  KafkaService.subscribe('order.confirmed', ...)
// Producers use:  KafkaService.emit('order.confirmed', { key: tenantId, value: payload })

// ── Kafka Topics ──────────────────────────────────────────────────────────

export const Topics = {
  // Order domain
  ORDER_CONFIRMED:       'order.confirmed',
  ORDER_IN_PRODUCTION:   'order.in-production',
  ORDER_DISPATCHED:      'order.dispatched',
  ORDER_CANCELLED:       'order.cancelled',

  // Finance domain
  INVOICE_CREATED:       'finance.invoice-created',
  INVOICE_SENT:          'finance.invoice-sent',
  INVOICE_PAID:          'finance.invoice-paid',
  INVOICE_OVERDUE:       'finance.invoice-overdue',
  PAYMENT_RECORDED:      'finance.payment-recorded',

  // Production domain
  CUT_ORDER_CREATED:     'production.cut-order-created',
  CUT_ORDER_COMPLETED:   'production.cut-order-completed',
  LINE_PLAN_STARTED:     'production.line-plan-started',
  LINE_PLAN_COMPLETED:   'production.line-plan-completed',
  WIP_STAGE_COMPLETED:   'production.wip-stage-completed',

  // MRP domain
  MRP_RUN_COMPLETED:     'mrp.run-completed',
  PR_APPROVED:           'mrp.pr-approved',

  // Supplier domain
  PO_DISPATCHED:         'supplier.po-dispatched',
} as const;

export type TopicName = typeof Topics[keyof typeof Topics];

// ── Base Event ────────────────────────────────────────────────────────────

export interface BaseEvent {
  tenantId:  string;
  timestamp: string;  // ISO 8601
}

// ── Order Events ──────────────────────────────────────────────────────────

export interface OrderConfirmedEvent extends BaseEvent {
  orderId:      string;
  buyerId:      string;
  poNumber:     string;
  deliveryDate: string;  // ISO date
  lineCount:    number;
  totalQty:     number;
  confirmedBy:  string;  // userId
}

export interface OrderInProductionEvent extends BaseEvent {
  orderId:  string;
  poNumber: string;
}

export interface OrderDispatchedEvent extends BaseEvent {
  orderId:    string;
  poNumber:   string;
  shipmentId: string;
  vehicleNo?: string;
}

export interface OrderCancelledEvent extends BaseEvent {
  orderId:      string;
  poNumber:     string;
  cancelledBy:  string;
  reason?:      string;
}

// ── Finance Events ────────────────────────────────────────────────────────

export interface InvoiceCreatedEvent extends BaseEvent {
  invoiceId:  string;
  invoiceNo:  string;
  type:       'SALES' | 'PURCHASE';
  total:      number;
  gstAmount:  number;
  buyerId?:   string;
  orderId?:   string;
}

export interface InvoiceSentEvent extends BaseEvent {
  invoiceId: string;
  invoiceNo: string;
  irnNumber?: string;
}

export interface InvoicePaidEvent extends BaseEvent {
  invoiceId: string;
  invoiceNo: string;
  total:     number;
  buyerId?:  string;
}

export interface InvoiceOverdueEvent extends BaseEvent {
  invoiceId:    string;
  invoiceNo:    string;
  total:        number;
  outstanding:  number;
  dueDate:      string;
  daysOverdue:  number;
}

export interface PaymentRecordedEvent extends BaseEvent {
  paymentId:    string;
  invoiceId:    string;
  invoiceNo:    string;
  amount:       number;
  mode:         string;
  newPaidTotal: number;
  invoiceStatus: string;
}

// ── Production Events ─────────────────────────────────────────────────────

export interface CutOrderCreatedEvent extends BaseEvent {
  cutOrderId:     string;
  cutOrderNumber: string;
  orderId:        string;
  styleCode:      string;
  plannedQty:     number;
}

export interface CutOrderCompletedEvent extends BaseEvent {
  cutOrderId:     string;
  cutOrderNumber: string;
  orderId:        string;
  cutQty:         number;
  damagedQty:     number;
}

export interface LinePlanStartedEvent extends BaseEvent {
  linePlanId: string;
  lineNumber: string;
  orderId:    string;
  styleCode:  string;
  targetQty:  number;
}

export interface LinePlanCompletedEvent extends BaseEvent {
  linePlanId:  string;
  lineNumber:  string;
  orderId:     string;
  achievedQty: number;
  rejectQty:   number;
  efficiency?: number;
}

export interface WipStageCompletedEvent extends BaseEvent {
  wipRecordId: string;
  orderId:     string;
  styleCode:   string;
  stage:       string;
  inputQty:    number;
  outputQty:   number;
  rejectQty:   number;
}

// ── MRP Events ────────────────────────────────────────────────────────────

export interface MrpRunCompletedEvent extends BaseEvent {
  mrpRunId:         string;
  orderCount:       number;
  lineCount:        number;
  requisitionCount: number;
  durationMs:       number;
}

export interface PrApprovedEvent extends BaseEvent {
  prIds:      string[];
  count:      number;
  approvedBy: string;
}

// ── Supplier Events ───────────────────────────────────────────────────────

export interface PoDispatchedEvent extends BaseEvent {
  poId:       string;
  poNumber:   string;
  supplierId: string;
}
