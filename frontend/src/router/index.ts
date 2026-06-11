import { createRouter, createWebHistory } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    icon?: string
    subtitle?: string
    panel?: string // L1 面板 key，左列显示
    section?: string // L2 区块标题，同一 panel 下的子分类（纯文本 section header）
    hideInMenu?: boolean // 设为 true 则不出现在大菜单导航中
  }
}

/** L1 分组 → 右区面板自定义标题（未配置则回退到分组名本身） */
export const menuPanelTitles: Record<string, string> = {}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: () => import('@/views/overview/DashboardView.vue'),
      meta: {
        title: '仪表盘',
        icon: 'mdi-view-dashboard',
        subtitle: 'Aemeath 机器人管理面板概览',
      },
    },
    {
      path: '/checkin',
      redirect: '/checkin/records',
    },
    {
      path: '/checkin/records',
      name: 'checkin-records',
      component: () => import('@/views/checkin/CheckinRecordsView.vue'),
      meta: {
        title: '签到记录',
        icon: 'mdi-calendar-check',
        subtitle: '查看群签到历史记录',
        panel: '功能模块',
        section: '群签到',
      },
    },
    {
      path: '/checkin/stats',
      name: 'checkin-stats',
      component: () => import('@/views/checkin/CheckinStatsView.vue'),
      meta: {
        title: '签到统计',
        icon: 'mdi-chart-line',
        subtitle: '群签到汇总、排行榜与趋势分析',
        panel: '功能模块',
        section: '群签到',
      },
    },
    {
      path: '/feedback',
      name: 'feedback',
      component: () => import('@/views/feedback/FeedbackView.vue'),
      meta: {
        title: '用户反馈',
        icon: 'mdi-message-alert',
        subtitle: '管理用户反馈和建议',
        panel: '功能模块',
      },
    },
    {
      path: '/jrlp',
      name: 'jrlp',
      component: () => import('@/views/jrlp/JrlpView.vue'),
      meta: {
        title: '今日老婆',
        icon: 'mdi-heart',
        subtitle: '管理群老婆抽取记录',
        panel: '功能模块',
      },
    },
    {
      path: '/like',
      redirect: '/like/tasks',
    },
    {
      path: '/like/tasks',
      name: 'like-tasks',
      component: () => import('@/views/like/LikeTasksView.vue'),
      meta: {
        title: '点赞任务',
        icon: 'mdi-thumb-up',
        subtitle: '管理每日定时点赞任务',
        panel: '功能模块',
        section: '点赞',
      },
    },
    {
      path: '/like/history',
      name: 'like-history',
      component: () => import('@/views/like/LikeHistoryView.vue'),
      meta: {
        title: '点赞历史',
        icon: 'mdi-history',
        subtitle: '查看点赞执行记录',
        panel: '功能模块',
        section: '点赞',
      },
    },
    {
      path: '/personnel',
      redirect: '/personnel/users',
    },
    {
      path: '/personnel/users',
      name: 'personnel-users',
      component: () => import('@/views/personnel/PersonnelUsersView.vue'),
      meta: {
        title: '用户管理',
        icon: 'mdi-account-group',
        subtitle: '管理和查看机器人用户信息',
        panel: '用户与聊天',
        section: '人员管理',
      },
    },
    {
      path: '/personnel/groups',
      name: 'personnel-groups',
      component: () => import('@/views/personnel/PersonnelGroupsView.vue'),
      meta: {
        title: '群聊管理',
        icon: 'mdi-forum',
        subtitle: '管理和查看机器人加入的群聊',
        panel: '用户与聊天',
        section: '人员管理',
      },
    },
    {
      path: '/personnel/admins',
      name: 'personnel-admins',
      component: () => import('@/views/personnel/PersonnelAdminsView.vue'),
      meta: {
        title: '超级管理员',
        icon: 'mdi-shield-crown',
        subtitle: '管理机器人超级管理员权限',
        panel: '用户与聊天',
        section: '人员管理',
      },
    },
    {
      path: '/permissions',
      name: 'permissions',
      component: () => import('@/views/permission/PermissionView.vue'),
      meta: {
        title: '权限管理',
        icon: 'mdi-shield-check',
        subtitle: '管理各群/用户的功能权限配置',
        panel: '用户与聊天',
        section: '权限管理',
      },
    },
    {
      path: '/llm',
      redirect: '/llm/providers',
    },
    {
      path: '/llm/providers',
      name: 'llm-providers',
      component: () => import('@/views/llm/LLMProvidersView.vue'),
      meta: {
        title: '提供商',
        icon: 'mdi-server-network',
        subtitle: '管理 LLM 服务提供商配置',
        panel: '大模型',
      },
    },
    {
      path: '/llm/models',
      name: 'llm-models',
      component: () => import('@/views/llm/LLMModelsView.vue'),
      meta: {
        title: '模型管理',
        icon: 'mdi-brain',
        subtitle: '管理和配置 LLM 模型',
        panel: '大模型',
      },
    },
    {
      path: '/chat',
      redirect: '/chat/messages',
    },
    {
      path: '/chat/messages',
      name: 'chat-messages',
      component: () => import('@/views/chat/ChatMessagesView.vue'),
      meta: {
        title: '消息记录',
        icon: 'mdi-message-text-outline',
        subtitle: '查看群聊和私聊消息记录',
        panel: '用户与聊天',
        section: '聊天记录',
      },
    },
    {
      path: '/chat/archive',
      name: 'chat-archive',
      component: () => import('@/views/chat/ChatArchiveView.vue'),
      meta: {
        title: '归档管理',
        icon: 'mdi-archive-outline',
        subtitle: '查看和管理聊天记录归档',
        panel: '用户与聊天',
        section: '聊天记录',
      },
    },
    {
      path: '/queue',
      name: 'queue',
      component: () => import('@/views/system/QueueView.vue'),
      meta: {
        title: '任务队列',
        icon: 'mdi-tray-full',
        subtitle: '查看定时任务调度与消息队列状态',
        panel: '系统',
      },
    },
    {
      path: '/logs',
      name: 'logs',
      component: () => import('@/views/system/LogsView.vue'),
      meta: {
        title: '应用日志',
        icon: 'mdi-text-box-outline',
        subtitle: '实时日志流',
        panel: '系统',
      },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/settings/SettingsView.vue'),
      meta: {
        title: '设置',
        icon: 'mdi-cog',
        subtitle: 'Aemeath 机器人管理面板设置',
        panel: '系统',
      },
    },
    {
      path: '/bot',
      name: 'bot-profile',
      component: () => import('@/views/bot/BotView.vue'),
      meta: {
        title: 'Bot 信息',
        icon: 'mdi-robot',
        subtitle: '查看和管理 Bot 账号信息',
        hideInMenu: true,
      },
    },
  ],
})

router.afterEach((to) => {
  const pageTitle = to.meta?.title as string | undefined
  document.title = pageTitle ? `${pageTitle} | Aemeath` : 'Aemeath'
})

export default router
