/** OSS 模块生命周期注册 —— 创建共享客户端并确保 bucket 存在。 */

import { logger } from '@logger'

import { loadConfig } from '../config.js'
import { Service, Provide, Startup } from '../lifecycle/decorators/index.js'

import { createOssClient } from './client.js'
import type { OssBuckets, OssBundle } from './client.js'

const log = logger.child({ module: 'oss' })

@Service({ name: 'oss_bootstrap' })
export class OssBootstrap {
  /** 对外暴露为 'oss' 键：{ client, buckets } */
  @Provide('oss')
  oss!: OssBundle

  @Startup
  async start(): Promise<void> {
    const config = loadConfig()
    const client = createOssClient({
      endpointUrl: config.S3_ENDPOINT_URL,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      region: config.S3_REGION,
    })
    const buckets: OssBuckets = {
      archive: config.S3_ARCHIVE_BUCKET,
      media: config.S3_MEDIA_BUCKET,
      render: config.S3_RENDER_BUCKET,
    }

    for (const [name, bucket] of Object.entries(buckets) as [string, string][]) {
      const exists = await client.bucketExists(bucket)
      if (!exists) {
        const region: string = config.S3_REGION
        await client.makeBucket(bucket, region)
        log.info({ bucket }, `创建 bucket: ${bucket}`)
      }
      log.debug({ name, bucket }, 'bucket 就绪')
    }

    this.oss = { client, buckets }
  }
}
