<template>
  <PageLayout>
    <!-- Bot 状态 + 系统信息 -->
    <v-row class="mb-4">
      <v-col cols="12" md="8">
        <v-card
          rounded="lg"
          :style="`border-left: 4px solid ${botStore.online ? 'rgb(var(--v-theme-success))' : 'rgba(var(--v-theme-on-surface), 0.2)'}`"
          height="100%"
        >
          <v-card-text class="d-flex align-center ga-4 pa-5">
            <v-avatar size="72" color="surface-variant">
              <v-img v-if="botStore.avatarUrl" :src="botStore.avatarUrl" />
              <v-icon v-else icon="mdi-robot" size="40" />
            </v-avatar>
            <div class="flex-grow-1">
              <div class="d-flex align-center ga-2 mb-1">
                <span class="text-h6 font-weight-bold">{{ botStore.nickname ?? '未连接' }}</span>
                <v-chip
                  :color="botStore.online ? 'success' : 'default'"
                  size="x-small"
                  variant="tonal"
                >
                  {{ botStore.online ? '在线' : '离线' }}
                </v-chip>
              </div>
              <div class="text-body-2 text-medium-emphasis">
                {{ botStore.userId ? `QQ: ${botStore.userId}` : '—' }}
              </div>
            </div>
            <v-btn variant="tonal" size="small" to="/bot" prepend-icon="mdi-pencil">管理</v-btn>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="4">
        <v-card rounded="lg" height="100%">
          <v-card-text class="pa-5 d-flex flex-column justify-space-between h-100">
            <div>
              <div class="text-overline text-medium-emphasis mb-1">系统</div>
              <div class="text-h6 font-weight-bold mb-1">Aemeath Bot</div>
              <div class="text-body-2 text-medium-emphasis">{{ currentTime }}</div>
            </div>
            <v-btn
              variant="tonal"
              size="small"
              to="/queue"
              prepend-icon="mdi-tray-full"
              class="mt-3 align-self-start"
            >
              查看队列
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- 统计数字 -->
    <v-row class="mb-4">
      <v-col v-for="stat in stats" :key="stat.label" cols="6" md="3">
        <v-card rounded="lg" variant="tonal" :color="stat.color">
          <v-card-text class="pa-4">
            <div class="d-flex align-center ga-2 mb-2">
              <v-icon size="20">{{ stat.icon }}</v-icon>
              <span class="text-caption font-weight-medium">{{ stat.label }}</span>
            </div>
            <div class="text-h5 font-weight-bold">
              {{ stat.loading ? '…' : stat.value }}
            </div>
            <div class="text-caption text-medium-emphasis mt-1">{{ stat.desc }}</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- 快捷导航 -->
    <v-card rounded="lg">
      <v-card-title class="pa-4 pb-2 text-body-1 font-weight-bold">
        <v-icon start size="20">mdi-lightning-bolt</v-icon>
        快捷导航
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-4">
        <v-row>
          <v-col v-for="nav in quickNavs" :key="nav.to" cols="6" sm="4" md="3">
            <v-card variant="outlined" rounded="lg" class="pa-3 cursor-pointer" :to="nav.to" hover>
              <div class="d-flex align-center ga-2 mb-1">
                <v-icon :color="nav.color" size="20">{{ nav.icon }}</v-icon>
                <span class="text-body-2 font-weight-medium">{{ nav.title }}</span>
              </div>
              <div class="text-caption text-medium-emphasis">{{ nav.subtitle }}</div>
            </v-card>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </PageLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

import PageLayout from '@/layouts/PageLayout.vue'
import { useBotStore } from '@/stores/bot'
import { usePersonnelStore } from '@/stores/personnel'
import { useQueueStore } from '@/stores/queue'

const botStore = useBotStore()
const queueStore = useQueueStore()
const personnelStore = usePersonnelStore()

// 当前时间（每分钟刷新）
const currentTime = ref(new Date().toLocaleString('zh-CN'))
let clockTimer: ReturnType<typeof setInterval> | null = null

const personnelLoading = ref(true)

const stats = computed(() => [
  {
    label: '活跃任务',
    value: queueStore.activeTasks.length,
    icon: 'mdi-run',
    color: 'blue',
    desc: '正在执行中',
    loading: !queueStore.connected,
  },
  {
    label: 'Worker 节点',
    value: queueStore.workers.length,
    icon: 'mdi-server',
    color: queueStore.workers.length > 0 ? 'success' : 'grey',
    desc: queueStore.workers.length > 0 ? '在线节点' : '无在线节点',
    loading: !queueStore.connected,
  },
  {
    label: '群聊',
    value: personnelStore.groups.total,
    icon: 'mdi-forum',
    color: 'indigo',
    desc: '已加入群组',
    loading: personnelLoading.value,
  },
  {
    label: '用户',
    value: personnelStore.users.total,
    icon: 'mdi-account-group',
    color: 'teal',
    desc: '已知用户总数',
    loading: personnelLoading.value,
  },
])

const quickNavs = [
  {
    to: '/queue',
    icon: 'mdi-tray-full',
    title: '任务队列',
    subtitle: '队列状态监控',
    color: 'purple',
  },
  {
    to: '/chat/messages',
    icon: 'mdi-message-text-outline',
    title: '消息记录',
    subtitle: '查看聊天记录',
    color: 'blue',
  },
  {
    to: '/chat/archive',
    icon: 'mdi-archive-outline',
    title: '归档管理',
    subtitle: '聊天记录归档',
    color: 'teal',
  },
  {
    to: '/personnel/users',
    icon: 'mdi-account-group',
    title: '用户管理',
    subtitle: '管理用户信息',
    color: 'indigo',
  },
  {
    to: '/personnel/groups',
    icon: 'mdi-forum',
    title: '群聊管理',
    subtitle: '管理群组信息',
    color: 'deep-purple',
  },
  {
    to: '/permissions',
    icon: 'mdi-shield-check',
    title: '权限管理',
    subtitle: '功能开关控制',
    color: 'orange',
  },
  {
    to: '/checkin/records',
    icon: 'mdi-calendar-check',
    title: '签到记录',
    subtitle: '查看打卡历史',
    color: 'green',
  },
  {
    to: '/logs',
    icon: 'mdi-text-box-outline',
    title: '应用日志',
    subtitle: '实时日志流',
    color: 'grey',
  },
]

onMounted(async () => {
  clockTimer = setInterval(() => {
    currentTime.value = new Date().toLocaleString('zh-CN')
  }, 60000)

  // 以较长间隔连接队列 SSE，减少仪表盘对连接的占用
  queueStore.connect(30)

  await Promise.allSettled([
    personnelStore.loadUsers({ page: 1, page_size: 1 }),
    personnelStore.loadGroups({ page: 1, page_size: 1 }),
  ])
  personnelLoading.value = false
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
  queueStore.disconnect()
})
</script>
