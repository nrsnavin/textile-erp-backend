// src/modules/finance/gst/gst.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';

// ── Indian GST rate slabs ─────────────────────────────────────────────────────
// Standard HSN-based rate tiers used in the Indian textile industry.
// Override via the `gstPct` field on each line item if needed.

export const GST_RATE_SLABS = [0, 5, 12, 18, 28] as const;
export type GstRateSlab = (typeof GST_RATE_SLABS)[number];

// ── HSN → GST rate mapping (textile-specific) ────────────────────────────────
// Chapter 50–63 of the HSN code covers textiles.
// This is a simplified lookup; real implementations may query a master table.
const HSN_RATE_MAP: Record<string, number> = {
  // Cotton & natural fibres (Chapter 52)
  '5201': 5,   // Raw cotton
  '5205': 5,   // Cotton yarn
  '5208': 5,   // Woven cotton fabric
  '5209': 5,   // Woven cotton fabric (heavier)
  '5210': 5,   // Woven cotton + blend fabric
  // Synthetic fibres (Chapter 54-55)
  '5402': 12,  // Synthetic filament yarn
  '5407': 12,  // Woven synthetic fabric
  '5503': 12,  // Synthetic staple fibres
  '5515': 12,  // Woven synthetic staple fabric
  // Knitted & crocheted (Chapter 60)
  '6001': 12,  // Pile fabrics, knitted
  '6004': 12,  // Knitted fabrics
  '6006': 12,  // Other knitted fabrics
  // Garments (Chapter 61-62)
  '6101': 12,  // Men's overcoats, knitted
  '6104': 12,  // Women's suits, knitted
  '6109': 5,   // T-shirts, singlets (cotton: ≤ ₹1000 → 5%)
  '6203': 12,  // Men's suits, woven
  '6204': 12,  // Women's suits, woven
  '6205': 12,  // Men's shirts
  '6206': 12,  // Women's blouses
  // Made-ups (Chapter 63)
  '6301': 12,  // Blankets & travelling rugs
  '6302': 12,  // Bed linen, table linen
  // Job work / services
  '9988': 18,  // Manufacturing services (job work)
  '9989': 18,  // Other manufacturing services
  '9997': 18,  // Other services
};

export interface GstBreakdown {
  /** Taxable amount before GST. */
  taxableAmount: number;
  /** Central GST (intra-state). */
  cgst: number;
  /** State GST (intra-state). */
  sgst: number;
  /** Integrated GST (inter-state). */
  igst: number;
  /** Total GST (cgst+sgst or igst). */
  totalGst: number;
  /** Grand total (taxable + GST). */
  grandTotal: number;
  /** Applied GST rate (percentage). */
  appliedRate: number;
  /** Whether IGST was applied (inter-state). */
  isInterState: boolean;
}

export interface LineGstInput {
  qty: number;
  rate: number;      // per-unit rate
  gstPct?: number;   // explicit GST %, overrides HSN lookup
  hsnCode?: string;  // used for HSN → rate lookup
}

export interface InvoiceGstSummary {
  subtotal: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalGst: number;
  grandTotal: number;
  lineBreakdowns: GstBreakdown[];
}

@Injectable()
export class GstService {

  /**
   * Resolve the GST rate for a line item.
   * Priority: explicit gstPct > HSN lookup > default 12%.
   */
  resolveRate(gstPct?: number, hsnCode?: string): number {
    if (gstPct !== undefined && gstPct !== null) {
      this.validateRate(gstPct);
      return gstPct;
    }

    if (hsnCode) {
      // Try exact match, then first 4 digits (chapter-level)
      const prefix4 = hsnCode.substring(0, 4);
      const rate = HSN_RATE_MAP[hsnCode] ?? HSN_RATE_MAP[prefix4];
      if (rate !== undefined) return rate;
    }

    // Default textile rate
    return 12;
  }

  /**
   * Validate that a GST rate is a recognized slab.
   */
  validateRate(rate: number): void {
    if (!GST_RATE_SLABS.includes(rate as GstRateSlab)) {
      throw new BadRequestException(
        `Invalid GST rate ${rate}%. Valid slabs: ${GST_RATE_SLABS.join(', ')}%`,
      );
    }
  }

  /**
   * Compute GST breakdown for a single line item.
   *
   * @param taxableAmount - Amount before tax (qty × rate)
   * @param gstRate       - GST percentage (e.g. 12)
   * @param isInterState  - true → IGST; false → CGST+SGST split
   */
  computeLineGst(
    taxableAmount: number,
    gstRate: number,
    isInterState: boolean,
  ): GstBreakdown {
    const totalGst = this.round2(taxableAmount * gstRate / 100);

    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    if (isInterState) {
      igst = totalGst;
    } else {
      // Even split for intra-state
      cgst = this.round2(totalGst / 2);
      sgst = this.round2(totalGst - cgst); // remainder to avoid rounding loss
    }

    return {
      taxableAmount: this.round2(taxableAmount),
      cgst,
      sgst,
      igst,
      totalGst,
      grandTotal: this.round2(taxableAmount + totalGst),
      appliedRate: gstRate,
      isInterState,
    };
  }

  /**
   * Compute full invoice GST summary across all line items.
   *
   * @param lines         - Array of line items with qty, rate, optional gstPct/hsnCode
   * @param isInterState  - true if buyer is in a different state than seller
   */
  computeInvoiceGst(
    lines: LineGstInput[],
    isInterState: boolean,
  ): InvoiceGstSummary {
    let subtotal = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalGst = 0;
    const lineBreakdowns: GstBreakdown[] = [];

    for (const line of lines) {
      const gstRate = this.resolveRate(line.gstPct, line.hsnCode);
      const taxableAmount = this.round2(line.qty * line.rate);
      const breakdown = this.computeLineGst(taxableAmount, gstRate, isInterState);

      subtotal += breakdown.taxableAmount;
      totalCgst += breakdown.cgst;
      totalSgst += breakdown.sgst;
      totalIgst += breakdown.igst;
      totalGst += breakdown.totalGst;
      lineBreakdowns.push(breakdown);
    }

    return {
      subtotal: this.round2(subtotal),
      totalCgst: this.round2(totalCgst),
      totalSgst: this.round2(totalSgst),
      totalIgst: this.round2(totalIgst),
      totalGst: this.round2(totalGst),
      grandTotal: this.round2(subtotal + totalGst),
      lineBreakdowns,
    };
  }

  /** Round to 2 decimal places (banker's rounding avoided — standard for GST). */
  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
