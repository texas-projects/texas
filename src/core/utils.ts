/**
 * 通用辅助工具函数。
 */

/** Asia/Shanghai 时区标识（IANA 标准）。 */
export const SHANGHAI_TZ = 'Asia/Shanghai'

/** 计算分页总页数（向上取整除法）。 */
export function ceilDiv(total: number, pageSize: number): number {
  return Math.ceil(total / pageSize)
}
