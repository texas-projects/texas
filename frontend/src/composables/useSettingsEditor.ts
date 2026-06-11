/**
 * useSettingsEditor —— 作用域感知的配置读写 Composable。
 * 支持群/用户两种作用域，可按前缀和分类过滤。
 */

import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import {
  fetchGroupSettings,
  fetchUserSettings,
  setGroupSetting,
  setUserSetting,
  batchSetGroupSettings,
} from '@/apis/settings'
import type { SettingValue } from '@/apis/settings'

export interface SettingsEditorScope {
  group?: number | null
  user?: number | null
}

export function useSettingsEditor(options: {
  prefix?: string
  scope: Ref<SettingsEditorScope>
  category?: 'permission' | 'config'
}) {
  const values = ref<Record<string, SettingValue>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function reload(): Promise<void> {
    const s = options.scope.value
    if (!s.group && !s.user) {
      values.value = {}
      return
    }
    loading.value = true
    error.value = null
    try {
      let raw: Record<string, SettingValue>
      if (s.group) {
        raw = await fetchGroupSettings(s.group, options.prefix)
      } else {
        raw = await fetchUserSettings(s.user!, options.prefix)
      }

      // 按 category 过滤（客户端侧，依赖 schema store）
      if (options.category) {
        const { useSettingsSchemaStore } = await import('@/stores/settingsSchema')
        const schemaStore = useSettingsSchemaStore()
        await schemaStore.ensureLoaded()
        const allowedKeys = new Set(
          schemaStore.schemas.filter((sc) => sc.category === options.category).map((sc) => sc.key),
        )
        raw = Object.fromEntries(Object.entries(raw).filter(([k]) => allowedKeys.has(k)))
      }

      values.value = raw
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '加载配置失败'
    } finally {
      loading.value = false
    }
  }

  /** 保存单项配置，value 为 null 时后端会重置为默认值。 */
  async function save(key: string, value: unknown): Promise<void> {
    const s = options.scope.value
    try {
      if (s.group) {
        await setGroupSetting(s.group, key, value)
      } else if (s.user) {
        await setUserSetting(s.user, key, value)
      }
      // 乐观更新本地状态
      values.value[key] = { value, overridden: value !== null }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '保存失败'
      throw e
    }
  }

  /** 重置配置项为默认值（POST value=null），重置后重新拉取实际默认值。 */
  async function reset(key: string): Promise<void> {
    await save(key, null)
    await reload()
  }

  /** 批量保存配置（仅支持群作用域）。 */
  async function batchSave(entries: { key: string; value: unknown }[]): Promise<void> {
    const s = options.scope.value
    if (!s.group) {
      error.value = 'batchSave 仅支持群作用域'
      return
    }
    try {
      await batchSetGroupSettings(s.group, entries)
      // 乐观更新本地状态
      for (const entry of entries) {
        values.value[entry.key] = { value: entry.value, overridden: entry.value !== null }
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '批量保存失败'
      throw e
    }
  }

  // scope 变化时自动重新加载
  watch(() => options.scope.value, reload, { deep: true, immediate: true })

  return { values, loading, error, save, reset, batchSave, reload }
}
