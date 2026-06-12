/**
 * 统一 API 响应格式 —— 所有 REST API 端点均使用 ok() / fail() 构造响应。
 */

/** 统一响应结构。 */
export interface ApiResponse<T = unknown> {
  code: number
  data: T
  message: string
}

/** 构造成功响应。 */
export function ok<T>(data: T, message = 'success'): ApiResponse<T> {
  return { code: 0, data, message }
}

/** 构造失败响应。 */
export function fail(message: string, data: unknown = null): ApiResponse {
  return { code: -1, data, message }
}
