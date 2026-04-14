import { EInvoiceService } from './einvoice.service';

describe('EInvoiceService', () => {
  let service: EInvoiceService;

  beforeEach(() => {
    // Create with mocked dependencies — we only test buildPayload (pure logic)
    const mockHttp: any = {};
    const mockConfig: any = {
      get: (key: string, def: string) => def,
    };
    service = new EInvoiceService(mockHttp, mockConfig);
  });

  describe('buildPayload', () => {
    const baseParams = {
      invoice: {
        invoiceNo:   'INV-2026-0001',
        invoiceDate: new Date(2026, 3, 14), // April 14, 2026
        subtotal:    25000,
        gstAmount:   1250,
        total:       26250,
        lines: [
          { description: 'Cotton fabric 40s', hsnCode: '5208', qty: 100, rate: 250, gstPct: 5, amount: 26250 },
        ],
      },
      seller: {
        Gstin: '29AADCB2230M1ZP',
        LglNm: 'Textile Corp Pvt Ltd',
        Addr1: '123 Industrial Area',
        Loc:   'Mumbai',
        Pin:   400001,
        Stcd:  '27',
      },
      buyer: {
        Gstin: '06BZAHM6385P6Z2',
        LglNm: 'Fashion House LLC',
        Pos:   '07',
        Addr1: '456 Market Street',
        Loc:   'Delhi',
        Pin:   110001,
        Stcd:  '07',
      },
      isInterState: true,
    };

    it('builds correct Version and TranDtls', () => {
      const payload = service.buildPayload(baseParams);

      expect(payload.Version).toBe('1.1');
      expect(payload.TranDtls.TaxSch).toBe('GST');
      expect(payload.TranDtls.SupTyp).toBe('B2B');
    });

    it('formats date as DD/MM/YYYY', () => {
      const payload = service.buildPayload(baseParams);

      expect(payload.DocDtls.Dt).toBe('14/04/2026');
      expect(payload.DocDtls.No).toBe('INV-2026-0001');
      expect(payload.DocDtls.Typ).toBe('INV');
    });

    it('maps seller and buyer details correctly', () => {
      const payload = service.buildPayload(baseParams);

      expect(payload.SellerDtls.Gstin).toBe('29AADCB2230M1ZP');
      expect(payload.SellerDtls.LglNm).toBe('Textile Corp Pvt Ltd');
      expect(payload.BuyerDtls.Gstin).toBe('06BZAHM6385P6Z2');
      expect(payload.BuyerDtls.Pos).toBe('07');
    });

    it('uses IGST for inter-state supply', () => {
      const payload = service.buildPayload(baseParams);

      // Line: 100 * 250 = 25000, 5% GST = 1250
      expect(payload.ItemList[0].IgstAmt).toBe(1250);
      expect(payload.ItemList[0].CgstAmt).toBe(0);
      expect(payload.ItemList[0].SgstAmt).toBe(0);
      expect(payload.ValDtls.IgstVal).toBe(1250);
      expect(payload.ValDtls.CgstVal).toBe(0);
    });

    it('splits CGST/SGST for intra-state supply', () => {
      const payload = service.buildPayload({ ...baseParams, isInterState: false });

      expect(payload.ItemList[0].CgstAmt).toBe(625);
      expect(payload.ItemList[0].SgstAmt).toBe(625);
      expect(payload.ItemList[0].IgstAmt).toBe(0);
      expect(payload.ValDtls.CgstVal).toBe(625);
      expect(payload.ValDtls.SgstVal).toBe(625);
      expect(payload.ValDtls.IgstVal).toBe(0);
    });

    it('computes correct value details', () => {
      const payload = service.buildPayload(baseParams);

      expect(payload.ValDtls.AssVal).toBe(25000);
      expect(payload.ValDtls.TotInvVal).toBe(26250);
    });

    it('numbers item serial numbers sequentially', () => {
      const multiLineParams = {
        ...baseParams,
        invoice: {
          ...baseParams.invoice,
          lines: [
            { description: 'Item A', hsnCode: '5208', qty: 10, rate: 100, gstPct: 5, amount: 1050 },
            { description: 'Item B', hsnCode: '5402', qty: 20, rate: 200, gstPct: 12, amount: 4480 },
            { description: 'Item C', hsnCode: '9988', qty: 1, rate: 5000, gstPct: 18, amount: 5900 },
          ],
        },
      };

      const payload = service.buildPayload(multiLineParams);

      expect(payload.ItemList.length).toBe(3);
      expect(payload.ItemList[0].SlNo).toBe('1');
      expect(payload.ItemList[1].SlNo).toBe('2');
      expect(payload.ItemList[2].SlNo).toBe('3');
    });

    it('handles multiple lines with different GST rates', () => {
      const params = {
        ...baseParams,
        invoice: {
          ...baseParams.invoice,
          lines: [
            { description: 'Cotton', hsnCode: '5208', qty: 100, rate: 100, gstPct: 5, amount: 10500 },
            { description: 'Synthetic', hsnCode: '5402', qty: 50, rate: 200, gstPct: 12, amount: 11200 },
          ],
        },
      };

      const payload = service.buildPayload(params);

      // Line 1: 10000 * 5% = 500 IGST
      expect(payload.ItemList[0].AssAmt).toBe(10000);
      expect(payload.ItemList[0].IgstAmt).toBe(500);
      // Line 2: 10000 * 12% = 1200 IGST
      expect(payload.ItemList[1].AssAmt).toBe(10000);
      expect(payload.ItemList[1].IgstAmt).toBe(1200);

      expect(payload.ValDtls.AssVal).toBe(20000);
      expect(payload.ValDtls.IgstVal).toBe(1700);
      expect(payload.ValDtls.TotInvVal).toBe(21700);
    });

    it('accepts ISO date string for invoiceDate', () => {
      const params = {
        ...baseParams,
        invoice: {
          ...baseParams.invoice,
          invoiceDate: '2026-01-15T00:00:00.000Z',
        },
      };

      const payload = service.buildPayload(params);
      expect(payload.DocDtls.Dt).toBe('15/01/2026');
    });

    it('uses custom supplyType when provided', () => {
      const payload = service.buildPayload({
        ...baseParams,
        supplyType: 'SEZWP',
      });

      expect(payload.TranDtls.SupTyp).toBe('SEZWP');
    });
  });
});
