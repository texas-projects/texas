/**
 * S3 上传服务 —— 封装 Parquet 文件和 manifest 的 S3 上传操作。
 */

import { logger, type Logger } from '@logger'
import { Client as MinioClient } from 'minio'

/** S3 归档配置（从外部注入，对应环境变量）。 */
export interface S3Settings {
  endpointUrl: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  archiveBucket: string
  archivePrefix: string
}

/** Parquet 归档 manifest 结构。 */
export interface ArchiveManifest {
  version: number
  partition: string
  period: { start: string; end: string }
  stats: { total_rows: number }
  archive: {
    format: string
    compression: string
    original_size_bytes: number
    compressed_size_bytes: number
    compression_ratio: number
    sha256: string
  }
  archived_at: string
  archived_by: string
}

/**
 * 负责 S3 文件上传操作，与归档编排逻辑解耦。
 *
 * 使用 minio npm 客户端，兼容 MinIO 和 AWS S3。
 */
export class ArchiveS3 {
  private readonly client: MinioClient
  private readonly settings: S3Settings
  private readonly _log: Logger = logger.child({ name: 'ArchiveS3' })

  constructor(settings: S3Settings) {
    this.settings = settings

    // 解析 endpointUrl，提取 host / port / useSSL
    let endpointHost = 's3.amazonaws.com'
    let endpointPort = 443
    let useSSL = true

    if (settings.endpointUrl) {
      const parsed = new URL(settings.endpointUrl)
      endpointHost = parsed.hostname
      endpointPort = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
      useSSL = parsed.protocol === 'https:'
    }

    this.client = new MinioClient({
      endPoint: endpointHost,
      port: endpointPort,
      useSSL,
      accessKey: settings.accessKeyId,
      secretKey: settings.secretAccessKey,
      region: settings.region,
    })
  }

  /** 返回当前 S3 配置（只读）。 */
  getSettings(): Readonly<S3Settings> {
    return this.settings
  }

  /**
   * 确保 bucket 存在，不存在时自动创建。
   */
  async ensureBucket(bucket: string): Promise<void> {
    const exists = await this.client.bucketExists(bucket)
    if (!exists) {
      await this.client.makeBucket(bucket, this.settings.region)
    }
  }

  /**
   * 上传 Buffer 到 S3 指定路径。
   */
  async upload(bucket: string, key: string, data: Buffer): Promise<void> {
    await this.ensureBucket(bucket)
    await this.client.putObject(bucket, key, data, data.length)
  }

  /**
   * 上传本地文件到 S3。
   */
  async uploadFile(
    filePath: string,
    s3Key: string,
    metadata: Record<string, string>,
  ): Promise<void> {
    await this.ensureBucket(this.settings.archiveBucket)
    await this.client.fPutObject(this.settings.archiveBucket, s3Key, filePath, metadata)
    this._log.info({ bucket: this.settings.archiveBucket, key: s3Key }, '文件已上传至 S3')
  }

  /**
   * 上传 manifest.json 到 S3。
   */
  async uploadManifest(manifest: ArchiveManifest, s3Key: string): Promise<void> {
    const body = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8')
    await this.upload(this.settings.archiveBucket, s3Key, body)
  }

  /**
   * 构建归档 manifest 对象。
   */
  static buildManifest(
    partitionName: string,
    periodStart: Date,
    periodEnd: Date,
    totalRows: number,
    originalBytes: number,
    compressedBytes: number,
    sha256Hex: string,
  ): ArchiveManifest {
    const ratio =
      compressedBytes > 0 ? Math.round((originalBytes / compressedBytes) * 100) / 100 : 0

    return {
      version: 1,
      partition: partitionName,
      period: {
        start: periodStart.toISOString().slice(0, 10),
        end: periodEnd.toISOString().slice(0, 10),
      },
      stats: { total_rows: totalRows },
      archive: {
        format: 'parquet',
        compression: 'zstd (built-in)',
        original_size_bytes: originalBytes,
        compressed_size_bytes: compressedBytes,
        compression_ratio: ratio,
        sha256: sha256Hex,
      },
      archived_at: new Date().toISOString(),
      archived_by: 'aemeath-worker',
    }
  }
}
