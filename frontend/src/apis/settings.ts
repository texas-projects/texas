/**
 * Settings REST API 封装。
 */

import http from './client'
import type { ApiResponse } from './types'

// ── 类型定义 ──

export interface SettingNodeSchema {
  key: string
  type: 'boolean' | 'number' | 'string' | 'enum'
  default: unknown
  description: string
  enumOptions?: Record<string, number>
  scope: 'all' | 'group' | 'user'
  owner: string
  ownerDisplayName: string
  category: 'permission' | 'config'
}

export interface SettingValue {
  value: unknown
  overridden: boolean
}

// ── API 函数 ──

const BASE = '/api/settings'

/** 获取所有配置项 Schema，可按前缀过滤。 */
export async function fetchSchemas(prefix?: string): Promise<SettingNodeSchema[]> {
  const params = prefix ? { prefix } : {}
  const { data } = await http.get<ApiResponse<SettingNodeSchema[]>>(`${BASE}/schemas`, { params })
  return data.data
}

/** 读取指定群的配置值（含 Schema 默认值回退）。 */
export async function fetchGroupSettings(
  groupId: number,
  prefix?: string,
): Promise<Record<string, SettingValue>> {
  const params = prefix ? { prefix } : {}
  const { data } = await http.get<ApiResponse<Record<string, SettingValue>>>(
    `${BASE}/groups/${groupId}`,
    { params },
  )
  return data.data
}

/** 读取指定用户的配置值（含 Schema 默认值回退）。 */
export async function fetchUserSettings(
  userId: number,
  prefix?: string,
): Promise<Record<string, SettingValue>> {
  const params = prefix ? { prefix } : {}
  const { data } = await http.get<ApiResponse<Record<string, SettingValue>>>(
    `${BASE}/users/${userId}`,
    { params },
  )
  return data.data
}

/** 设置群级单项配置，value 为 null 时重置为默认值。 */
export async function setGroupSetting(groupId: number, key: string, value: unknown): Promise<void> {
  await http.post(`${BASE}/groups/${groupId}/${encodeURIComponent(key)}`, { value })
}

/** 设置用户级单项配置，value 为 null 时重置为默认值。 */
export async function setUserSetting(userId: number, key: string, value: unknown): Promise<void> {
  await http.post(`${BASE}/users/${userId}/${encodeURIComponent(key)}`, { value })
}

/** 批量设置群级配置。 */
export async function batchSetGroupSettings(
  groupId: number,
  entries: { key: string; value: unknown }[],
): Promise<void> {
  await http.post(`${BASE}/groups/${groupId}/batch`, { entries })
}
