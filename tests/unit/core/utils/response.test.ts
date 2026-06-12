import { describe, expect, it } from 'vitest'

import { fail, ok } from '@/core/response.js'

describe('ok', () => {
  it('应当返回 code=0 和默认 message', () => {
    const result = ok({ id: 1 })

    expect(result).toEqual({ code: 0, data: { id: 1 }, message: 'success' })
  })

  it('应当使用自定义 message', () => {
    const result = ok({ id: 1 }, 'created')

    expect(result).toEqual({ code: 0, data: { id: 1 }, message: 'created' })
  })

  it('data 为 null 时应当正常工作', () => {
    const result = ok(null)

    expect(result).toEqual({ code: 0, data: null, message: 'success' })
  })

  it('data 为数组时应当正常工作', () => {
    const result = ok([1, 2, 3])

    expect(result).toEqual({ code: 0, data: [1, 2, 3], message: 'success' })
  })
})

describe('fail', () => {
  it('应当返回 code=-1 和 data=null', () => {
    const result = fail('not found')

    expect(result).toEqual({ code: -1, data: null, message: 'not found' })
  })

  it('应当支持自定义 data', () => {
    const result = fail('validation error', { field: 'name' })

    expect(result).toEqual({
      code: -1,
      data: { field: 'name' },
      message: 'validation error',
    })
  })
})
