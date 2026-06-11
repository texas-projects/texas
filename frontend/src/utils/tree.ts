/**
 * Settings Schema 树形结构工具函数：分组、过滤、归并。
 */

import type { SettingNodeSchema, SettingValue } from '@/apis/settings'

/** 按 owner 将 schema 列表分组。 */
export function groupSchemasByOwner(
  schemas: SettingNodeSchema[],
): Record<string, SettingNodeSchema[]> {
  const result: Record<string, SettingNodeSchema[]> = {}
  for (const s of schemas) {
    ;(result[s.owner] ??= []).push(s)
  }
  return result
}

/** 过滤指定 category 的 schema 列表。 */
export function filterSchemasByCategory(
  schemas: SettingNodeSchema[],
  category: 'permission' | 'config',
): SettingNodeSchema[] {
  return schemas.filter((s) => s.category === category)
}

/** 从 schema 列表提取 owner -> ownerDisplayName 映射（保留首次出现值）。 */
export function buildOwnerDisplayNames(schemas: SettingNodeSchema[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const s of schemas) {
    if (!(s.owner in result)) result[s.owner] = s.ownerDisplayName
  }
  return result
}

/** 将 DB 覆盖值合并到基础默认值表，覆盖项标记 overridden: true。 */
export function mergeSettingValues(
  defaults: Record<string, unknown>,
  overrides: Record<string, SettingValue>,
): Record<string, SettingValue> {
  const result: Record<string, SettingValue> = {}
  for (const [key, value] of Object.entries(defaults)) {
    result[key] = { value, overridden: false }
  }
  for (const [key, sv] of Object.entries(overrides)) {
    result[key] = { value: sv.value, overridden: true }
  }
  return result
}
