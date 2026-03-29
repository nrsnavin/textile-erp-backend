// src/shared/services/s3.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService }      from '@nestjs/config';
import {
  S3Client, PutObjectCommand,
  GetObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl }       from '@aws-sdk/s3-request-presigner';
import { randomUUID }         from 'crypto';

// ── S3Service ─────────────────────────────────────────────────────────────
// Handles file uploads for:
//   - QC photos         → qc/{tenantId}/{inspectionId}/{filename}
//   - Invoices          → invoices/{tenantId}/{invoiceId}/{filename}
//   - Delivery challans → dc/{tenantId}/{stepId}/{filename}
//   - OCR bill scans    → ocr/{tenantId}/{sessionId}/{filename}
//   - Tech packs        → techpacks/{tenantId}/{orderId}/{filename}
//
// S3 keys are stored in the database — never the pre-signed URL.
// Pre-signed URLs are generated at API response time (TTL: 1 hour).

export type S3Folder =
  | 'qc'
  | 'invoices'
  | 'dc'
  | 'ocr'
  | 'techpacks'
  | 'reports';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3:     S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get<string>('S3_BUCKET_NAME', 'textile-erp-files');

    this.s3 = new S3Client({
      region:      config.get<string>('AWS_REGION', 'ap-south-1'),
      credentials: {
        accessKeyId:     config.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
  }

  // ── Upload a file ─────────────────────────────────────────────────────
  // Returns the S3 key — store this in your database column, not the URL.
  async upload(params: {
    folder:   S3Folder;
    tenantId: string;
    refId:    string;        // inspectionId, invoiceId, orderId etc.
    buffer:   Buffer;
    mimeType: string;
    filename?: string;
  }): Promise<string> {
    const ext      = params.mimeType.split('/')[1] ?? 'bin';
    const filename = params.filename ?? `${randomUUID()}.${ext}`;
    const key      = `${params.folder}/${params.tenantId}/${params.refId}/${filename}`;

    await this.s3.send(new PutObjectCommand({
      Bucket:      this.bucket,
      Key:         key,
      Body:        params.buffer,
      ContentType: params.mimeType,
      // Metadata for compliance tracking
      Metadata: {
        'tenant-id': params.tenantId,
        'ref-id':    params.refId,
        'folder':    params.folder,
      },
    }));

    this.logger.log(`Uploaded: ${key}`);
    return key;
  }

  // ── Get a pre-signed URL for a key ────────────────────────────────────
  // Called at API response time — never store the URL in the database.
  // Pre-signed URLs expire — storing them would cause broken links.
  async getPresignedUrl(
    key:            string,
    expiresSeconds: number = 3600, // 1 hour default
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key:    key,
    });
    return getSignedUrl(this.s3, command, { expiresIn: expiresSeconds });
  }

  // ── Resolve an array of S3 keys to pre-signed URLs ────────────────────
  // Useful for QC photo galleries — resolve all photo keys in one call.
  async resolveKeys(
    keys:           string[],
    expiresSeconds: number = 3600,
  ): Promise<string[]> {
    return Promise.all(
      keys.map(key => this.getPresignedUrl(key, expiresSeconds))
    );
  }

  // ── Delete a file ─────────────────────────────────────────────────────
  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key:    key,
    }));
    this.logger.log(`Deleted: ${key}`);
  }

  // ── Get a pre-signed upload URL (for client-side uploads) ─────────────
  // Flutter app can upload directly to S3 without going through the API.
  async getUploadUrl(params: {
    folder:   S3Folder;
    tenantId: string;
    refId:    string;
    mimeType: string;
    expiresSeconds?: number;
  }): Promise<{ uploadUrl: string; key: string }> {
    const { PutObjectCommand: Cmd } = await import('@aws-sdk/client-s3');
    const { getSignedUrl: gsv }     = await import('@aws-sdk/s3-request-presigner');

    const ext = params.mimeType.split('/')[1] ?? 'bin';
    const key = `${params.folder}/${params.tenantId}/${params.refId}/${randomUUID()}.${ext}`;

    const command   = new Cmd({
      Bucket:      this.bucket,
      Key:         key,
      ContentType: params.mimeType,
    });
    const uploadUrl = await gsv(this.s3, command, {
      expiresIn: params.expiresSeconds ?? 300, // 5 minutes for upload
    });

    return { uploadUrl, key };
  }
}
