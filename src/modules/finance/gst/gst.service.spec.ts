import { BadRequestException } from '@nestjs/common';
import { GstService, GST_RATE_SLABS } from './gst.service';

describe('GstService', () => {
  let gst: GstService;

  beforeEach(() => {
    gst = new GstService();
  });

  // ── resolveRate ─────────────────────────────────────────────────────────

  describe('resolveRate', () => {
    it('returns explicit gstPct when provided', () => {
      expect(gst.resolveRate(18, '5208')).toBe(18);
    });

    it('looks up 4-digit HSN code when gstPct is undefined', () => {
      expect(gst.resolveRate(undefined, '5208')).toBe(5);   // cotton fabric
      expect(gst.resolveRate(undefined, '5402')).toBe(12);  // synthetic yarn
      expect(gst.resolveRate(undefined, '9988')).toBe(18);  // job work
    });

    it('falls back to first-4-digit prefix for longer HSN codes', () => {
      // '520812' → prefix '5208' → 5%
      expect(gst.resolveRate(undefined, '520812')).toBe(5);
    });

    it('defaults to 12% when HSN code is unknown', () => {
      expect(gst.resolveRate(undefined, '9999')).toBe(12);
    });

    it('defaults to 12% when both gstPct and hsnCode are missing', () => {
      expect(gst.resolveRate(undefined, undefined)).toBe(12);
    });

    it('throws for invalid GST rate slab', () => {
      expect(() => gst.resolveRate(7)).toThrow(BadRequestException);
      expect(() => gst.resolveRate(15)).toThrow(BadRequestException);
    });

    it('accepts all valid rate slabs', () => {
      for (const rate of GST_RATE_SLABS) {
        expect(gst.resolveRate(rate)).toBe(rate);
      }
    });
  });

  // ── computeLineGst ─────────────────────────────────────────────────────

  describe('computeLineGst', () => {
    it('splits CGST+SGST evenly for intra-state', () => {
      const result = gst.computeLineGst(10000, 12, false);

      expect(result.taxableAmount).toBe(10000);
      expect(result.cgst).toBe(600);
      expect(result.sgst).toBe(600);
      expect(result.igst).toBe(0);
      expect(result.totalGst).toBe(1200);
      expect(result.grandTotal).toBe(11200);
      expect(result.isInterState).toBe(false);
    });

    it('applies full IGST for inter-state', () => {
      const result = gst.computeLineGst(10000, 18, true);

      expect(result.cgst).toBe(0);
      expect(result.sgst).toBe(0);
      expect(result.igst).toBe(1800);
      expect(result.totalGst).toBe(1800);
      expect(result.grandTotal).toBe(11800);
      expect(result.isInterState).toBe(true);
    });

    it('handles 0% GST (exempt)', () => {
      const result = gst.computeLineGst(5000, 0, false);

      expect(result.cgst).toBe(0);
      expect(result.sgst).toBe(0);
      expect(result.totalGst).toBe(0);
      expect(result.grandTotal).toBe(5000);
    });

    it('rounds to 2 decimal places', () => {
      // 333.33 * 5% = 16.6665 → 16.67
      const result = gst.computeLineGst(333.33, 5, false);

      expect(result.totalGst).toBe(16.67);
      expect(result.cgst).toBe(8.34);  // Math.round(16.67/2 * 100)/100
      expect(result.sgst).toBe(8.33);  // remainder
      expect(result.grandTotal).toBe(350);
    });

    it('handles CGST/SGST odd-cent rounding without losing pennies', () => {
      // 100 * 5% = 5.00 → cgst=2.50, sgst=2.50
      const result = gst.computeLineGst(100, 5, false);

      expect(result.cgst + result.sgst).toBe(result.totalGst);
    });
  });

  // ── computeInvoiceGst ──────────────────────────────────────────────────

  describe('computeInvoiceGst', () => {
    it('sums across multiple line items', () => {
      const lines = [
        { qty: 100, rate: 250, hsnCode: '5208' },  // 25000 @ 5%
        { qty: 50,  rate: 400, hsnCode: '5402' },   // 20000 @ 12%
      ];

      const result = gst.computeInvoiceGst(lines, false);

      expect(result.subtotal).toBe(45000);
      expect(result.lineBreakdowns.length).toBe(2);

      // Line 1: 25000 * 5% = 1250
      expect(result.lineBreakdowns[0].totalGst).toBe(1250);
      // Line 2: 20000 * 12% = 2400
      expect(result.lineBreakdowns[1].totalGst).toBe(2400);

      expect(result.totalGst).toBe(3650);
      expect(result.grandTotal).toBe(48650);
    });

    it('uses IGST for inter-state invoices', () => {
      const lines = [{ qty: 10, rate: 1000, gstPct: 18 }];

      const result = gst.computeInvoiceGst(lines, true);

      expect(result.totalCgst).toBe(0);
      expect(result.totalSgst).toBe(0);
      expect(result.totalIgst).toBe(1800);
      expect(result.totalGst).toBe(1800);
    });

    it('uses CGST+SGST for intra-state invoices', () => {
      const lines = [{ qty: 10, rate: 1000, gstPct: 18 }];

      const result = gst.computeInvoiceGst(lines, false);

      expect(result.totalCgst).toBe(900);
      expect(result.totalSgst).toBe(900);
      expect(result.totalIgst).toBe(0);
      expect(result.totalGst).toBe(1800);
    });

    it('handles mixed GST rates across lines', () => {
      const lines = [
        { qty: 1, rate: 1000, gstPct: 5 },   // 50
        { qty: 1, rate: 1000, gstPct: 12 },   // 120
        { qty: 1, rate: 1000, gstPct: 18 },   // 180
        { qty: 1, rate: 1000, gstPct: 28 },   // 280
      ];

      const result = gst.computeInvoiceGst(lines, false);

      expect(result.subtotal).toBe(4000);
      expect(result.totalGst).toBe(630);
      expect(result.grandTotal).toBe(4630);
    });

    it('handles empty lines array', () => {
      const result = gst.computeInvoiceGst([], false);

      expect(result.subtotal).toBe(0);
      expect(result.totalGst).toBe(0);
      expect(result.grandTotal).toBe(0);
      expect(result.lineBreakdowns).toEqual([]);
    });

    it('handles fractional quantities and rates', () => {
      const lines = [{ qty: 2.5, rate: 133.33, hsnCode: '5208' }];

      const result = gst.computeInvoiceGst(lines, false);

      // 2.5 * 133.33 = 333.325 → rounded 333.33
      expect(result.subtotal).toBe(333.33);
      // 333.33 * 5% = 16.6665 → 16.67
      expect(result.totalGst).toBe(16.67);
      expect(result.grandTotal).toBe(350);
    });
  });
});
