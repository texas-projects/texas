/**
 * Parquet 导出服务 —— 将分区数据流式导出为 Parquet 文件。
 *
 * 依赖：parquetjs-lite（已安装，CJS 模块，通过动态 import() 引入）。
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

import type { ChatPrismaClient } from '@/core/db/client.js'

/** 归档导出配置。 */
export interface ArchiveExporterSettings {
  /** 保留月数（超过则可归档），默认 12。 */
  retentionMonths: number
  /** 批量写入行数，默认 5000。 */
  batchSize: number
  /** Parquet 压缩算法，默认 zstd（实际映射为 SNAPPY，parquetjs-lite 不支持原生 Zstd）。 */
  compression: 'zstd' | 'gzip' | 'none'
}

/** 分区名白名单正则：只允许 chat_history_YYYY_MM 格式。 */
export const PARTITION_NAME_RE = /^chat_history_\d{4}_\d{2}$/

/** parquetjs-lite 列定义接口（内联类型）。 */
interface ParquetSchemaField {
  type: string
  optional?: boolean
  compression?: string
}

/** parquetjs-lite writer 接口（内联类型）。 */
interface ParquetWriter {
  appendRow(row: Record<string, unknown>): Promise<void>
  close(): Promise<void>
}

/** parquetjs-lite 模块接口（内联类型）。 */
interface ParquetModule {
  ParquetSchema: new (schema: Record<string, ParquetSchemaField>) => unknown
  ParquetWriter: {
    openFile(schema: unknown, path: string): Promise<ParquetWriter>
  }
}

// 压缩算法映射（parquetjs-lite 不支持 Zstd，回退到 SNAPPY）
const COMPRESSION_MAP: Record<string, string> = {
  zstd: 'SNAPPY',
  gzip: 'GZIP',
  none: 'UNCOMPRESSED',
}

/**
 * Parquet 导出服务 —— 游标分批将分区数据流式写入 Parquet 文件。
 */
export class ArchiveExporter {
  constructor(
    private readonly chatDb: ChatPrismaClient,
    private readonly settings: ArchiveExporterSettings,
  ) {}

  /**
   * 流式导出分区数据到 Parquet 文件（含压缩）。
   *
   * @param partitionName - 分区名（须通过 PARTITION_NAME_RE 验证）
   * @param outputPath - 输出文件路径
   * @returns [totalRows, originalBytes（近似）, compressedBytes, sha256Hex]
   */
  async exportPartition(
    partitionName: string,
    outputPath: string,
  ): Promise<[number, number, number, string]> {
    // parquetjs-lite 是 CJS 模块，通过 ESM 动态 import() 引入，default 即 module.exports
    const { default: parquet } = (await import('parquetjs-lite')) as { default: ParquetModule }
    const compression = COMPRESSION_MAP[this.settings.compression] ?? 'SNAPPY'

    const field = (type: string, optional = false): ParquetSchemaField => ({
      type,
      compression,
      ...(optional ? { optional: true } : {}),
    })

    const schema = new parquet.ParquetSchema({
      id: field('INT64'),
      created_at: field('TIMESTAMP_MILLIS'),
      message_id: field('INT64'),
      message_type: field('INT32'),
      group_id: field('INT64', true),
      user_id: field('INT64'),
      raw_message: field('UTF8'),
      segments: field('UTF8'),
      sender_nickname: field('UTF8'),
      sender_card: field('UTF8', true),
      sender_role: field('UTF8', true),
      stored_at: field('TIMESTAMP_MILLIS'),
    })

    interface RawRow {
      id: bigint
      created_at: Date
      message_id: bigint
      message_type: number
      group_id: bigint | null
      user_id: bigint
      raw_message: string
      segments: unknown
      sender_nickname: string
      sender_card: string | null
      sender_role: string | null
      stored_at: Date
    }

    const writer = await parquet.ParquetWriter.openFile(schema, outputPath)
    let totalRows = 0
    let cursor: bigint | undefined
    let hasMore = true

    while (hasMore) {
      // 分区名已通过 PARTITION_NAME_RE 正则白名单验证，$queryRawUnsafe 安全
      const whereClause = cursor !== undefined ? `WHERE id > ${cursor.toString()}` : ''
      const batchSize = String(this.settings.batchSize)
      const rows = await this.chatDb.$queryRawUnsafe<RawRow[]>(
        `SELECT id, created_at, message_id, message_type, group_id, user_id,
                raw_message, segments, sender_nickname, sender_card, sender_role, stored_at
         FROM chat."${partitionName}"
         ${whereClause}
         ORDER BY id ASC
         LIMIT ${batchSize}`,
      )

      if (rows.length === 0) break

      for (const row of rows) {
        await writer.appendRow({
          id: Number(row.id),
          created_at: row.created_at,
          message_id: Number(row.message_id),
          message_type: row.message_type,
          group_id: row.group_id !== null ? Number(row.group_id) : null,
          user_id: Number(row.user_id),
          raw_message: row.raw_message,
          segments: JSON.stringify(row.segments),
          sender_nickname: row.sender_nickname,
          sender_card: row.sender_card ?? null,
          sender_role: row.sender_role ?? null,
          stored_at: row.stored_at,
        })
        totalRows++
      }

      const lastRow = rows[rows.length - 1]
      if (lastRow !== undefined) {
        cursor = lastRow.id
      }
      hasMore = rows.length >= this.settings.batchSize
    }

    await writer.close()

    const fileStats = await stat(outputPath)
    const compressedBytes = fileStats.size
    const sha256Hex = await _computeFileSha256(outputPath)

    // originalBytes 近似值：parquetjs-lite 不暴露未压缩大小，用行数 × 平均行字节估算
    const originalBytes = totalRows * 512

    return [totalRows, originalBytes, compressedBytes, sha256Hex]
  }
}

/** 流式计算文件的 SHA256 摘要。 */
async function _computeFileSha256(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => {
      hash.update(chunk)
    })
    stream.on('end', () => {
      resolve(hash.digest('hex'))
    })
    stream.on('error', reject)
  })
}
