<script setup lang="ts">
/**
 * PermissionView —— 权限管理页面，展示所有 category='permission' 的配置项。
 * 顶部作用域选择器（群/用户），下方按 owner 分组的权限表单。
 */
import { ref, computed, onMounted } from 'vue'
import PageLayout from '@/layouts/PageLayout.vue'
import GroupAutocomplete from '@/components/GroupAutocomplete.vue'
import UserAutocomplete from '@/components/UserAutocomplete.vue'
import SettingField from '@/components/settings/SettingField.vue'
import { useSettingsSchemaStore } from '@/stores/settingsSchema'
import { useSettingsEditor } from '@/composables/useSettingsEditor'
import type { SettingNodeSchema } from '@/apis/settings'

const schemaStore = useSettingsSchemaStore()

// ── 作用域状态 ──

type ScopeType = 'group' | 'user'
const scopeType = ref<ScopeType>('group')
const selectedGroup = ref<number | null>(null)
const selectedUser = ref<number | null>(null)

/** 响应式 scope 对象，传给 useSettingsEditor。 */
const scope = computed(() => ({
  group: scopeType.value === 'group' ? selectedGroup.value : null,
  user: scopeType.value === 'user' ? selectedUser.value : null,
}))

// ── 设置编辑器（仅 category='permission'）──

const { values, loading, error, save, reset } = useSettingsEditor({
  prefix: '',
  scope,
  category: 'permission',
})

/** 是否已选择目标。 */
const hasTarget = computed(() =>
  scopeType.value === 'group' ? selectedGroup.value !== null : selectedUser.value !== null,
)

/** 按 owner 分组的 permission schema，过滤出有权限项的 owner。 */
const ownerPermissionGroups = computed(() => {
  const result: { owner: string; displayName: string; schemas: SettingNodeSchema[] }[] = []
  for (const owner of schemaStore.owners) {
    const ownerSchemas = (schemaStore.byOwner[owner] ?? []).filter(
      (s) => s.category === 'permission',
    )
    if (ownerSchemas.length > 0) {
      result.push({
        owner,
        displayName: schemaStore.ownerDisplayNames[owner] ?? owner,
        schemas: ownerSchemas,
      })
    }
  }
  return result
})

onMounted(() => schemaStore.ensureLoaded())
</script>

<template>
  <PageLayout>
    <!-- 作用域选择器 -->
    <v-card rounded="lg" class="mb-4">
      <v-card-text class="pa-4">
        <div class="d-flex align-center gap-4 flex-wrap">
          <v-radio-group v-model="scopeType" inline hide-details density="compact" class="mr-2">
            <v-radio label="群聊" value="group" />
            <v-radio label="用户" value="user" />
          </v-radio-group>
          <div style="width: 300px">
            <GroupAutocomplete
              v-if="scopeType === 'group'"
              v-model="selectedGroup"
              label="选择群聊"
            />
            <UserAutocomplete v-else v-model="selectedUser" label="选择用户" />
          </div>
        </div>
        <v-alert v-if="error" type="error" density="compact" class="mt-3">{{ error }}</v-alert>
      </v-card-text>
    </v-card>

    <!-- 未选择目标时提示 -->
    <v-alert v-if="!hasTarget" type="info" variant="tonal" class="mb-4">
      请先选择{{ scopeType === 'group' ? '群聊' : '用户' }}，然后查看权限配置
    </v-alert>

    <!-- 按 owner 分组的权限卡片 -->
    <template v-else>
      <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

      <v-card v-for="group in ownerPermissionGroups" :key="group.owner" rounded="lg" class="mb-4">
        <v-card-title class="pa-4 pb-2 text-body-1 font-weight-bold">
          {{ group.displayName }}
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-4">
          <div
            v-for="schema in group.schemas"
            :key="schema.key"
            class="d-flex align-center py-2"
            style="border-bottom: 1px solid rgba(0, 0, 0, 0.06)"
          >
            <div class="flex-grow-1 mr-4">
              <div class="text-body-2 font-weight-medium">
                {{ schema.description || schema.key }}
              </div>
              <div class="text-caption text-medium-emphasis">{{ schema.key }}</div>
            </div>
            <SettingField
              :schema="schema"
              :value="values[schema.key]?.value ?? schema.default"
              :overridden="values[schema.key]?.overridden ?? false"
              :disabled="!hasTarget"
              @update:value="(v) => save(schema.key, v)"
              @reset="reset(schema.key)"
            />
          </div>
        </v-card-text>
      </v-card>

      <div
        v-if="ownerPermissionGroups.length === 0 && !loading"
        class="text-body-2 text-medium-emphasis"
      >
        暂无权限配置项
      </div>
    </template>
  </PageLayout>
</template>
