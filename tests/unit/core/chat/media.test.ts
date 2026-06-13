import { describe, it, expect, vi, beforeEach } from 'vitest'

import { MediaStorageService } from '@/core/chat/media.js'
import { uploadBuffer, objectExists } from '@/core/oss/utils.js'

// Mock fetch（必须在 import 之前通过 vi.stubGlobal，vitest 会 hoist vi.mock）
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock oss utils
vi.mock('@/core/oss/utils.js', () => ({
  uploadBuffer: vi.fn().mockResolvedValue(undefined),
  objectExists: vi.fn().mockResolvedValue(false),
}))

interface MockClient {
  presignedGetObject: ReturnType<typeof vi.fn>
}

function createMockClient(): MockClient {
  return {
    presignedGetObject: vi.fn().mockResolvedValue('https://presigned.url'),
  }
}

describe('MediaStorageService', () => {
  let service: MediaStorageService
  let client: MockClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = createMockClient()
    // MediaStorageService 构造函数第一个参数是 minio.Client，
    // 测试中用 mock 替代，通过 unknown 中转规避类型检查
    service = new MediaStorageService(
      client as unknown as ConstructorParameters<typeof MediaStorageService>[0],
      'test-media',
    )
  })

  describe('persist', () => {
    it('应下载、计算哈希、上传并返回 S3 key', async () => {
      const pngBuf = Buffer.from('fake-png-data')
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: () =>
          Promise.resolve(
            pngBuf.buffer.slice(pngBuf.byteOffset, pngBuf.byteOffset + pngBuf.byteLength),
          ),
      })

      const key = await service.persist('https://example.com/img.png')

      // key 格式: {2char}/{hash}.png
      expect(key).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}\.png$/)
      expect(uploadBuffer).toHaveBeenCalledOnce()
    })

    it('已存在时应跳过上传', async () => {
      const pngBuf = Buffer.from('existing')
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: () =>
          Promise.resolve(
            pngBuf.buffer.slice(pngBuf.byteOffset, pngBuf.byteOffset + pngBuf.byteLength),
          ),
      })
      vi.mocked(objectExists).mockResolvedValueOnce(true)

      await service.persist('https://example.com/dup.png')

      expect(uploadBuffer).not.toHaveBeenCalled()
    })

    it('下载失败应抛出错误', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 })
      await expect(service.persist('https://bad.url/404.png')).rejects.toThrow('下载失败')
    })

    it('无 content-type 时应从 URL 推断扩展名', async () => {
      const buf = Buffer.from('img-data')
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({}),
        arrayBuffer: () =>
          Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
      })

      const key = await service.persist('https://example.com/photo.webp')

      expect(key).toMatch(/\.webp$/)
    })

    it('jpeg 扩展名应规范化为 jpg', async () => {
      const buf = Buffer.from('jpeg-data')
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({}),
        arrayBuffer: () =>
          Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
      })

      const key = await service.persist('https://example.com/photo.jpeg')

      expect(key).toMatch(/\.jpg$/)
    })
  })

  describe('persistMany', () => {
    it('应并发处理多个 URL，失败的不包含在结果中', async () => {
      const buf = Buffer.from('data')
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'image/jpeg' }),
          arrayBuffer: () =>
            Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
        })
        .mockResolvedValueOnce({ ok: false, status: 500 })

      const results = await service.persistMany([
        'https://example.com/a.jpg',
        'https://example.com/fail.jpg',
      ])

      expect(results.size).toBe(1)
      expect(results.has('https://example.com/a.jpg')).toBe(true)
    })

    it('空数组应返回空 Map', async () => {
      const results = await service.persistMany([])
      expect(results.size).toBe(0)
    })
  })

  describe('getPresignedUrl', () => {
    it('应委托 client.presignedGetObject', async () => {
      const url = await service.getPresignedUrl('ab/abc123.png', 7200)
      expect(client.presignedGetObject).toHaveBeenCalledWith('test-media', 'ab/abc123.png', 7200)
      expect(url).toBe('https://presigned.url')
    })

    it('默认过期时间应为 3600 秒', async () => {
      await service.getPresignedUrl('ab/abc123.png')
      expect(client.presignedGetObject).toHaveBeenCalledWith('test-media', 'ab/abc123.png', 3600)
    })
  })
})
