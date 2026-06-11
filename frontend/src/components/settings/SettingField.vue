<script setup lang="ts">
/**
 * SettingField —— 根据 schema type 渲染配置项表单控件，append-icon 显示覆盖状态。
 */
import type { SettingNodeSchema } from '@/apis/settings'

const props = withDefaults(
  defineProps<{
    schema: SettingNodeSchema
    value: unknown
    overridden: boolean
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{
  'update:value': [value: unknown]
  reset: []
}>()

/** enum 选项列表（从 enumOptions keys 生成）。 */
const enumItems = props.schema.enumOptions ? Object.keys(props.schema.enumOptions) : []

function onUpdate(val: unknown) {
  emit('update:value', val)
}

function onResetClick() {
  if (props.overridden) emit('reset')
}
</script>

<template>
  <div class="d-flex align-center gap-2">
    <!-- boolean: v-switch -->
    <v-switch
      v-if="schema.type === 'boolean'"
      :model-value="Boolean(value)"
      :disabled="disabled"
      density="compact"
      hide-details
      color="primary"
      style="max-width: 300px"
      @update:model-value="onUpdate"
    />

    <!-- number: v-text-field -->
    <v-text-field
      v-else-if="schema.type === 'number'"
      :model-value="Number(value)"
      :disabled="disabled"
      type="number"
      density="compact"
      hide-details
      style="max-width: 300px"
      @update:model-value="(v) => onUpdate(Number(v))"
    />

    <!-- string: v-text-field -->
    <v-text-field
      v-else-if="schema.type === 'string'"
      :model-value="String(value ?? '')"
      :disabled="disabled"
      density="compact"
      hide-details
      style="max-width: 300px"
      @update:model-value="onUpdate"
    />

    <!-- enum: v-select -->
    <v-select
      v-else-if="schema.type === 'enum'"
      :model-value="String(value ?? '')"
      :items="enumItems"
      :disabled="disabled"
      density="compact"
      hide-details
      style="max-width: 300px"
      @update:model-value="onUpdate"
    />

    <!-- 覆盖状态图标 + tooltip -->
    <v-tooltip
      :text="overridden ? '已覆盖，点击可重置' : `默认值: ${schema.default}`"
      location="top"
    >
      <template #activator="{ props: tooltipProps }">
        <v-icon
          v-bind="tooltipProps"
          :icon="overridden ? 'mdi-circle-slice-8' : 'mdi-circle-outline'"
          :color="overridden ? 'primary' : 'medium-emphasis'"
          size="18"
          :style="overridden ? 'cursor: pointer' : 'cursor: default'"
          @click="onResetClick"
        />
      </template>
    </v-tooltip>
  </div>
</template>
