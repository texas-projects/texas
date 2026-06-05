/**
 * 聊天记录归档服务与 BullMQ 任务 —— 编排冷数据归档流程（发现分区 → 导出 → 上传 S3 → 清理）。
 */

import type { ArchiveStatus } from '../../../prisma/main/generated/index.js'
import type { ChatPrismaClient, MainPrismaClient } from '../db/client.js'
import { logger, type Logger } from '../logging/setup.js'

import { ArchiveExporter, PARTITION_NAME_RE } from './exporter.js'
import type { ArchiveExporterSettings } from './exporter.js'
import { ArchiveS3, type S3Settings } from './s3.js'

/** 归档单个分区的执行结果。 */
export interface PartitionArchiveResult {
  partition: string
  status: 'completed' | 'empty' | 'failed'
  rows?: number
  originalBytes?: number
  compressedBytes?: number
  s3Key?: string
  error?: string
}

/** 归档入口结果。 */
export interface ArchiveResult {
  status: 'completed' | 'no_partitions'
  message?: string
  results?: PartitionArchiveResult[]
}

/** BullMQ job data 结构。 */
export interface ArchiveJobData {
  partitionName?: string
}

/**
 * 聊天记录归档编排服务 —— 协调分区发现、导出、上传和状态更新。
 */
export class ArchiveService {
  private readonly exporter: ArchiveExporter
  private readonly s3: ArchiveS3
  private readonly _log: Logger = logger.child({ name: 'ArchiveService' })

  constructor(
    private readonly chatDb: ChatPrismaClient,
    private readonly mainDb: MainPrismaClient,
    private readonly exporterSettings: ArchiveExporterSettings,
    s3Settings: S3Settings,
  ) {
    this.exporter = new ArchiveExporter(chatDb, exporterSettings)
    this.s3 = new ArchiveS3(s3Settings)
  }

  // ════════════════════════════════════════════
  //  分区管理
  // ════════════════════════════════════════════

  /**
   * 确保当月和下月的分区存在。
   */
  async ensurePartitions(): Promise<{ status: string; message: string }> {
    await this.chatDb.$executeRaw`SELECT chat.create_monthly_partition(CURRENT_DATE)`
    await this.chatDb
      .$executeRaw`SELECT chat.create_monthly_partition((CURRENT_DATE + INTERVAL '1 month')::DATE)`
    return { status: 'ok', message: '分区已就绪' }
  }

  // ════════════════════════════════════════════
  //  归档主流程
  // ════════════════════════════════════════════

  /**
   * 执行归档流程。
   *
   * 如果未指定 partitionName，则自动发现超过保留月数的分区。
   */
  async archive(partitionName?: string): Promise<ArchiveResult> {
    let partitions: string[]

    if (partitionName != null) {
      if (!PARTITION_NAME_RE.test(partitionName)) {
        throw new Error(`非法分区名: ${partitionName}，格式须为 chat_history_YYYY_MM`)
      }
      partitions = [partitionName]
    } else {
      partitions = await this._discoverArchivablePartitions()
    }

    if (partitions.length === 0) {
      return { status: 'no_partitions', message: '没有需要归档的分区' }
    }

    const results: PartitionArchiveResult[] = []
    for (const part of partitions) {
      try {
        const result = await this._archivePartition(part)
        results.push(result)
      } catch (err) {
        this._log.error({ partition: part, err }, '归档分区失败')
        results.push({
          partition: part,
          status: 'failed',
          error: String(err),
        })
      }
    }

    return { status: 'completed', results }
  }

  /**
   * 获取归档日志列表（分页）。
   */
  async getArchiveLogs(
    page = 1,
    pageSize = 20,
  ): Promise<{
    items: unknown[]
    total: number
    page: number
    pageSize: number
    pages: number
  }> {
    const skip = (page - 1) * pageSize
    const [rawItems, total] = await Promise.all([
      this.mainDb.chatArchiveLog.findMany({
        orderBy: { periodStart: 'desc' },
        skip,
        take: pageSize,
      }),
      this.mainDb.chatArchiveLog.count(),
    ])

    // BigInt → Number 转换（JSON.stringify 不支持 BigInt）
    const items = rawItems.map((r) => ({
      ...r,
      totalRows: Number(r.totalRows),
      originalBytes: Number(r.originalBytes),
      compressedBytes: Number(r.compressedBytes),
    }))

    return {
      items,
      total,
      page,
      pageSize,
      pages: Math.ceil(total / pageSize),
    }
  }

  /**
   * 查询已完成的归档记录（按起始时间过滤）。
   */
  async listArchives(params: { periodStart: Date; limit?: number }): Promise<unknown[]> {
    const rows = await this.mainDb.chatArchiveLog.findMany({
      where: {
        periodStart: { gte: params.periodStart },
        status: 'completed',
      },
      orderBy: { periodStart: 'desc' },
      take: params.limit ?? 50,
    })
    // BigInt → Number 转换
    return rows.map((r) => ({
      ...r,
      totalRows: Number(r.totalRows),
      originalBytes: Number(r.originalBytes),
      compressedBytes: Number(r.compressedBytes),
    }))
  }

  // ════════════════════════════════════════════
  //  内部方法
  // ════════════════════════════════════════════

  private async _discoverArchivablePartitions(): Promise<string[]> {
    const retentionMs = this.exporterSettings.retentionMonths * 30 * 24 * 60 * 60 * 1000
    const cutoff = new Date(Date.now() - retentionMs)
    const year = cutoff.getFullYear().toString().padStart(4, '0')
    const month = (cutoff.getMonth() + 1).toString().padStart(2, '0')
    const cutoffSuffix = `${year}_${month}`

    interface PartitionRow {
      partition_name: string
    }
    const rows = await this.chatDb.$queryRaw<PartitionRow[]>`
      SELECT c.relname AS partition_name
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
      JOIN pg_namespace n ON n.oid = p.relnamespace
      WHERE n.nspname = 'chat'
        AND p.relname = 'chat_history'
        AND replace(c.relname, 'chat_history_', '') < ${cutoffSuffix}
      ORDER BY c.relname
    `

    const archivable = rows.map((r) => r.partition_name)
    if (archivable.length === 0) return []

    const existingLogs = await this.mainDb.chatArchiveLog.findMany({
      where: {
        partitionName: { in: archivable },
        status: 'completed',
      },
      select: { partitionName: true },
    })
    const alreadyArchived = new Set(existingLogs.map((l) => l.partitionName))
    return archivable.filter((p) => !alreadyArchived.has(p))
  }

  private async _archivePartition(partitionName: string): Promise<PartitionArchiveResult> {
    if (!PARTITION_NAME_RE.test(partitionName)) {
      throw new Error(`非法分区名: ${partitionName}，格式须为 chat_history_YYYY_MM`)
    }

    const suffix = partitionName.replace('chat_history_', '')
    const parts = suffix.split('_')
    const year = Number(parts[0])
    const month = Number(parts[1])

    const periodStart = new Date(year, month - 1, 1)
    const periodEnd = month === 12 ? new Date(year + 1, 0, 1) : new Date(year, month, 1)

    const archiveLog = await this.mainDb.chatArchiveLog.create({
      data: {
        partitionName,
        periodStart,
        periodEnd,
        s3Bucket: this.s3.getSettings().archiveBucket,
        s3Key: '',
        s3Sha256: '',
        status: 'pending',
      },
    })

    const archiveId = archiveLog.id

    try {
      await this._updateArchiveStatus(archiveId, 'exporting')

      const tmpDir = process.env.TMPDIR ?? '/tmp'
      const tmpPath = `${tmpDir}/${partitionName}_${Date.now().toString()}.parquet`

      const [totalRows, originalBytes, compressedBytes, sha256Hex] =
        await this.exporter.exportPartition(partitionName, tmpPath)

      if (totalRows === 0) {
        await this._updateArchiveStatus(archiveId, 'completed', '分区为空，跳过')
        return { partition: partitionName, status: 'empty', rows: 0 }
      }

      await this._updateArchiveStatus(archiveId, 'uploading')

      const yearPadded = year.toString().padStart(4, '0')
      const monthPadded = month.toString().padStart(2, '0')
      const s3Key = `${this.s3.getSettings().archivePrefix}/${yearPadded}/${monthPadded}/${partitionName}.parquet`

      await this.s3.uploadFile(tmpPath, s3Key, {
        partition: partitionName,
        period_start: periodStart.toISOString().slice(0, 10),
        period_end: periodEnd.toISOString().slice(0, 10),
        total_rows: String(totalRows),
        sha256: sha256Hex,
      })

      const manifest = ArchiveS3.buildManifest(
        partitionName,
        periodStart,
        periodEnd,
        totalRows,
        originalBytes,
        compressedBytes,
        sha256Hex,
      )
      const manifestKey = s3Key.replace('.parquet', '.manifest.json')
      await this.s3.uploadManifest(manifest, manifestKey)

      await this._updateArchiveStatus(archiveId, 'uploaded')

      await this.mainDb.chatArchiveLog.update({
        where: { id: archiveId },
        data: {
          totalRows: BigInt(totalRows),
          originalBytes: BigInt(originalBytes),
          compressedBytes: BigInt(compressedBytes),
          s3Key,
          s3Sha256: sha256Hex,
        },
      })

      // 分离并删除分区表（分区名已通过正则白名单验证）
      await this.chatDb.$executeRawUnsafe(
        `ALTER TABLE chat.chat_history DETACH PARTITION chat."${partitionName}"`,
      )
      await this.chatDb.$executeRawUnsafe(`DROP TABLE chat."${partitionName}"`)

      await this._updateArchiveStatus(archiveId, 'partition_dropped')

      await this.mainDb.chatArchiveLog.update({
        where: { id: archiveId },
        data: {
          status: 'completed',
          completedAt: new Date(),
        },
      })

      this._log.info({ partition: partitionName, rows: totalRows, compressedBytes }, '归档完成')

      return {
        partition: partitionName,
        status: 'completed',
        rows: totalRows,
        originalBytes,
        compressedBytes,
        s3Key,
      }
    } catch (err) {
      await this._updateArchiveStatus(archiveId, 'failed', String(err))
      throw err
    }
  }

  private async _updateArchiveStatus(
    archiveId: string,
    status: ArchiveStatus,
    errorMessage?: string,
  ): Promise<void> {
    await this.mainDb.chatArchiveLog.update({
      where: { id: archiveId },
      data: {
        status,
        ...(errorMessage != null ? { errorMessage } : {}),
        ...(status === 'completed' ? { completedAt: new Date() } : {}),
      },
    })
  }
}

/**
 * BullMQ processor 函数 —— 包装 ArchiveService.archive()。
 *
 * 使用方：在 Worker 进程中注册到 BullMQ Worker，传入 ArchiveService 实例后调用。
 */
export function archiveChatHistoryProcessor(
  service: ArchiveService,
): (job: { data: ArchiveJobData }) => Promise<ArchiveResult> {
  return async (job) => {
    return service.archive(job.data.partitionName)
  }
}
