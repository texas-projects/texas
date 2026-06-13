import { Readable } from 'node:stream'

import type { Client } from 'minio'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { uploadBuffer, downloadBuffer, objectExists, deleteObject } from '@/core/oss/utils.js'

interface MockClient {
  putObject: ReturnType<typeof vi.fn>
  getObject: ReturnType<typeof vi.fn>
  statObject: ReturnType<typeof vi.fn>
  removeObject: ReturnType<typeof vi.fn>
}

function createMockClient(): MockClient {
  return {
    putObject: vi.fn().mockResolvedValue(undefined),
    getObject: vi.fn(),
    statObject: vi.fn(),
    removeObject: vi.fn().mockResolvedValue(undefined),
  }
}

/** 将 MockClient 安全转换为 minio Client 接口（仅测试使用）。 */
function asClient(mock: MockClient): Client {
  return mock as unknown as Client
}

describe('oss/utils', () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
  })

  describe('uploadBuffer', () => {
    it('应调用 putObject 并传递 buffer 和 metadata', async () => {
      const buf = Buffer.from('hello')
      await uploadBuffer(asClient(client), 'bucket', 'key.png', buf, { 'x-custom': 'val' })
      expect(client.putObject).toHaveBeenCalledWith('bucket', 'key.png', buf, 5, {
        'x-custom': 'val',
      })
    })
  })

  describe('downloadBuffer', () => {
    it('应将 stream 聚合为 Buffer', async () => {
      const stream = Readable.from([Buffer.from('he'), Buffer.from('llo')])
      client.getObject.mockResolvedValue(stream)
      const result = await downloadBuffer(asClient(client), 'bucket', 'key.png')
      expect(result.toString()).toBe('hello')
    })
  })

  describe('objectExists', () => {
    it('对象存在时返回 true', async () => {
      client.statObject.mockResolvedValue({ size: 100 })
      expect(await objectExists(asClient(client), 'bucket', 'key')).toBe(true)
    })

    it('NotFound 时返回 false', async () => {
      client.statObject.mockRejectedValue({ code: 'NotFound' })
      expect(await objectExists(asClient(client), 'bucket', 'key')).toBe(false)
    })

    it('NoSuchKey 时返回 false', async () => {
      client.statObject.mockRejectedValue({ code: 'NoSuchKey' })
      expect(await objectExists(asClient(client), 'bucket', 'key')).toBe(false)
    })

    it('HTTP 404 时返回 false', async () => {
      client.statObject.mockRejectedValue({ statusCode: 404 })
      expect(await objectExists(asClient(client), 'bucket', 'key')).toBe(false)
    })

    it('其他错误应抛出', async () => {
      client.statObject.mockRejectedValue(new Error('network'))
      await expect(objectExists(asClient(client), 'bucket', 'key')).rejects.toThrow('network')
    })
  })

  describe('deleteObject', () => {
    it('应调用 removeObject', async () => {
      await deleteObject(asClient(client), 'bucket', 'key')
      expect(client.removeObject).toHaveBeenCalledWith('bucket', 'key')
    })
  })
})
