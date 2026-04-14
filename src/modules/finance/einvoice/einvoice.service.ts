// src/modules/finance/einvoice/einvoice.service.ts
//
// NIC e-Invoice API sandbox integration.
//
// API reference: https://einv-apisandbox.nic.in
// Auth: client_id + client_secret → /eivital/v1.04/auth (Basic Auth header)
// IRN:  POST /eicore/v1.06/Invoice with signed JSON payload
//
// Sandbox credentials are per-GSTIN. In production, the tenant must
// register on the NIC portal and obtain their own client_id/secret + GSTIN.
//
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService }   from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

// ── NIC e-Invoice JSON schema types ──────────────────────────────────────────

export interface EInvoiceSellerDetails {
  Gstin:  string;
  LglNm:  string;   // Legal name
  TrdNm?: string;   // Trade name
  Addr1:  string;
  Loc:    string;    // City
  Pin:    number;
  Stcd:   string;    // State code (e.g. "27" for Maharashtra)
}

export interface EInvoiceBuyerDetails {
  Gstin:  string;
  LglNm:  string;
  TrdNm?: string;
  Pos:    string;    // Place of supply (state code)
  Addr1:  string;
  Loc:    string;
  Pin:    number;
  Stcd:   string;
}

export interface EInvoiceItemDetails {
  SlNo:     string;     // Serial number "1", "2", ...
  PrdDesc:  string;     // Product description
  IsServc:  'Y' | 'N'; // Is service?
  HsnCd:    string;     // HSN code
  Qty:      number;
  Unit:     string;     // UQC code (e.g. "MTR", "KGS", "NOS")
  UnitPrice: number;    // Per-unit price
  TotAmt:   number;     // qty × unitPrice
  Discount: number;
  AssAmt:   number;     // Assessable amount (after discount)
  GstRt:    number;     // GST rate
  CgstAmt:  number;
  SgstAmt:  number;
  IgstAmt:  number;
  TotItemVal: number;   // Total item value incl GST
}

export interface EInvoiceValueDetails {
  AssVal:   number;     // Total assessable value
  CgstVal:  number;     // Total CGST
  SgstVal:  number;     // Total SGST
  IgstVal:  number;     // Total IGST
  TotInvVal: number;    // Total invoice value
}

export interface EInvoiceDocumentDetails {
  Typ:  'INV' | 'CRN' | 'DBN'; // Invoice / Credit Note / Debit Note
  No:   string;                  // Document number
  Dt:   string;                  // DD/MM/YYYY format
}

export interface EInvoiceTransactionDetails {
  TaxSch:  'GST';
  SupTyp:  'B2B' | 'SEZWP' | 'SEZWOP' | 'EXPWP' | 'EXPWOP' | 'B2CL';
  RegRev?: 'Y' | 'N';  // Reverse charge
}

export interface EInvoicePayload {
  Version:      '1.1';
  TranDtls:     EInvoiceTransactionDetails;
  DocDtls:      EInvoiceDocumentDetails;
  SellerDtls:   EInvoiceSellerDetails;
  BuyerDtls:    EInvoiceBuyerDetails;
  ItemList:     EInvoiceItemDetails[];
  ValDtls:      EInvoiceValueDetails;
}

// ── NIC API response types ───────────────────────────────────────────────────

export interface NicAuthResponse {
  Status:   number;
  AuthToken: string;
  TokenExpiry: string; // seconds
  Sek:      string;    // Session encryption key
}

export interface NicIrnResponse {
  Status:     number;
  AckNo:      number;
  AckDt:      string;
  Irn:        string;
  SignedInvoice: string;
  SignedQRCode:  string;
  EwbNo?:     number;
  EwbDt?:     string;
  EwbValidTill?: string;
}

export interface NicCancelResponse {
  Status:     number;
  Irn:        string;
  CancelDate: string;
}

export interface NicErrorResponse {
  Status:    number;
  ErrorDetails: Array<{
    error_code:    string;
    error_message: string;
    error_source:  string;
  }>;
}

// ── Service configuration ────────────────────────────────────────────────────

interface EInvoiceConfig {
  baseUrl:      string;
  clientId:     string;
  clientSecret: string;
  gstin:        string;    // Seller GSTIN for sandbox
}

@Injectable()
export class EInvoiceService {
  private readonly logger = new Logger(EInvoiceService.name);
  private readonly config: EInvoiceConfig;

  // Token cache — NIC tokens last ~6 hours
  private authToken: string | null = null;
  private sek:       string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(
    private readonly http:    HttpService,
    private readonly configService: ConfigService,
  ) {
    this.config = {
      baseUrl:      this.configService.get<string>('EINVOICE_BASE_URL', 'https://einv-apisandbox.nic.in'),
      clientId:     this.configService.get<string>('EINVOICE_CLIENT_ID', ''),
      clientSecret: this.configService.get<string>('EINVOICE_CLIENT_SECRET', ''),
      gstin:        this.configService.get<string>('EINVOICE_GSTIN', ''),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Authenticate with NIC e-Invoice API.
   * Uses Basic Auth with client_id:client_secret → returns AuthToken + SEK.
   */
  async authenticate(): Promise<{ authToken: string; sek: string }> {
    if (this.authToken && this.tokenExpiresAt && new Date() < this.tokenExpiresAt) {
      return { authToken: this.authToken, sek: this.sek! };
    }

    this.logger.log('Authenticating with NIC e-Invoice API...');

    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
    ).toString('base64');

    const { data } = await firstValueFrom(
      this.http.post<NicAuthResponse>(
        `${this.config.baseUrl}/eivital/v1.04/auth`,
        null,
        {
          headers: {
            Authorization: `Basic ${credentials}`,
            'client_id':     this.config.clientId,
            'client_secret': this.config.clientSecret,
            gstin:           this.config.gstin,
          },
        },
      ),
    );

    if (data.Status !== 1) {
      throw new BadRequestException('NIC e-Invoice authentication failed');
    }

    this.authToken = data.AuthToken;
    this.sek = data.Sek;
    // Set expiry with 5-minute buffer
    const expirySeconds = parseInt(data.TokenExpiry, 10) || 21600;
    this.tokenExpiresAt = new Date(Date.now() + (expirySeconds - 300) * 1000);

    this.logger.log(`NIC auth successful, token expires in ${expirySeconds}s`);
    return { authToken: this.authToken, sek: this.sek! };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GENERATE IRN
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate an IRN (Invoice Reference Number) for an invoice.
   * Submits the e-Invoice JSON to NIC and returns IRN + signed QR code.
   */
  async generateIrn(payload: EInvoicePayload): Promise<NicIrnResponse> {
    const { authToken } = await this.authenticate();

    this.logger.log(`Generating IRN for invoice ${payload.DocDtls.No}...`);

    const { data } = await firstValueFrom(
      this.http.post<NicIrnResponse | NicErrorResponse>(
        `${this.config.baseUrl}/eicore/v1.06/Invoice`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'client_id':   this.config.clientId,
            gstin:         this.config.gstin,
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    if ((data as NicErrorResponse).ErrorDetails) {
      const errors = (data as NicErrorResponse).ErrorDetails;
      const msg = errors.map(e => `${e.error_code}: ${e.error_message}`).join('; ');
      this.logger.error(`IRN generation failed: ${msg}`);
      throw new BadRequestException(`e-Invoice rejected by NIC: ${msg}`);
    }

    const result = data as NicIrnResponse;
    this.logger.log(`IRN generated: ${result.Irn} (AckNo: ${result.AckNo})`);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CANCEL IRN
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Cancel a previously generated IRN.
   * NIC allows cancellation within 24 hours of generation.
   */
  async cancelIrn(
    irn: string,
    reason: '1' | '2' | '3' | '4', // 1=Duplicate, 2=Data entry mistake, 3=Order cancelled, 4=Others
    remark: string,
  ): Promise<NicCancelResponse> {
    const { authToken } = await this.authenticate();

    this.logger.log(`Cancelling IRN: ${irn}...`);

    const { data } = await firstValueFrom(
      this.http.post<NicCancelResponse | NicErrorResponse>(
        `${this.config.baseUrl}/eicore/v1.06/Invoice/Cancel`,
        {
          Irn:     irn,
          CnlRsn:  reason,
          CnlRem:  remark,
        },
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'client_id':   this.config.clientId,
            gstin:         this.config.gstin,
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    if ((data as NicErrorResponse).ErrorDetails) {
      const errors = (data as NicErrorResponse).ErrorDetails;
      const msg = errors.map(e => `${e.error_code}: ${e.error_message}`).join('; ');
      this.logger.error(`IRN cancellation failed: ${msg}`);
      throw new BadRequestException(`e-Invoice cancellation rejected: ${msg}`);
    }

    const result = data as NicCancelResponse;
    this.logger.log(`IRN cancelled: ${result.Irn} at ${result.CancelDate}`);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET IRN DETAILS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch details of a previously generated IRN.
   */
  async getIrnDetails(irn: string): Promise<NicIrnResponse> {
    const { authToken } = await this.authenticate();

    const { data } = await firstValueFrom(
      this.http.get<NicIrnResponse | NicErrorResponse>(
        `${this.config.baseUrl}/eicore/v1.06/Invoice/irn/${irn}`,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'client_id':   this.config.clientId,
            gstin:         this.config.gstin,
          },
        },
      ),
    );

    if ((data as NicErrorResponse).ErrorDetails) {
      const errors = (data as NicErrorResponse).ErrorDetails;
      const msg = errors.map(e => `${e.error_code}: ${e.error_message}`).join('; ');
      throw new BadRequestException(`IRN lookup failed: ${msg}`);
    }

    return data as NicIrnResponse;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAYLOAD BUILDER — maps our Invoice model → NIC JSON
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build the NIC e-Invoice JSON payload from internal invoice data.
   *
   * @param invoice     - Internal invoice (with lines, buyer, GST breakdown)
   * @param sellerInfo  - Seller GSTIN + address (from tenant config)
   * @param buyerInfo   - Buyer GSTIN + address
   * @param isInterState - true for IGST, false for CGST+SGST
   */
  buildPayload(params: {
    invoice: {
      invoiceNo: string;
      invoiceDate: Date | string;
      subtotal: number;
      gstAmount: number;
      total: number;
      lines: Array<{
        description: string;
        hsnCode?: string;
        qty: number;
        rate: number;
        gstPct: number;
        amount: number;
      }>;
    };
    seller: EInvoiceSellerDetails;
    buyer:  EInvoiceBuyerDetails;
    isInterState: boolean;
    supplyType?: 'B2B' | 'SEZWP' | 'SEZWOP' | 'EXPWP' | 'EXPWOP' | 'B2CL';
  }): EInvoicePayload {
    const { invoice, seller, buyer, isInterState, supplyType } = params;

    // Format date as DD/MM/YYYY
    const invDate = invoice.invoiceDate instanceof Date
      ? invoice.invoiceDate
      : new Date(invoice.invoiceDate);
    const formattedDate = [
      String(invDate.getDate()).padStart(2, '0'),
      String(invDate.getMonth() + 1).padStart(2, '0'),
      String(invDate.getFullYear()),
    ].join('/');

    // Build item list
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalAssVal = 0;

    const itemList: EInvoiceItemDetails[] = invoice.lines.map((line, i) => {
      const taxableAmt = this.round2(line.qty * line.rate);
      const gstAmt = this.round2(taxableAmt * line.gstPct / 100);

      let cgst = 0, sgst = 0, igst = 0;
      if (isInterState) {
        igst = gstAmt;
      } else {
        cgst = this.round2(gstAmt / 2);
        sgst = this.round2(gstAmt - cgst);
      }

      totalCgst += cgst;
      totalSgst += sgst;
      totalIgst += igst;
      totalAssVal += taxableAmt;

      return {
        SlNo:      String(i + 1),
        PrdDesc:   line.description,
        IsServc:   'N' as const,
        HsnCd:     line.hsnCode ?? '5208',
        Qty:       line.qty,
        Unit:      'NOS',
        UnitPrice: line.rate,
        TotAmt:    taxableAmt,
        Discount:  0,
        AssAmt:    taxableAmt,
        GstRt:     line.gstPct,
        CgstAmt:   cgst,
        SgstAmt:   sgst,
        IgstAmt:   igst,
        TotItemVal: this.round2(taxableAmt + gstAmt),
      };
    });

    return {
      Version: '1.1',
      TranDtls: {
        TaxSch: 'GST',
        SupTyp: supplyType ?? 'B2B',
      },
      DocDtls: {
        Typ: 'INV',
        No:  invoice.invoiceNo,
        Dt:  formattedDate,
      },
      SellerDtls: seller,
      BuyerDtls:  buyer,
      ItemList:   itemList,
      ValDtls: {
        AssVal:    this.round2(totalAssVal),
        CgstVal:   this.round2(totalCgst),
        SgstVal:   this.round2(totalSgst),
        IgstVal:   this.round2(totalIgst),
        TotInvVal: this.round2(totalAssVal + totalCgst + totalSgst + totalIgst),
      },
    };
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
