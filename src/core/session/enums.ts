/**
 * 会话框架枚举类型。
 */

/** 会话超时策略。 */
export const TimeoutMode = {
  /** 超时后静默结束会话，不发送通知。 */
  SILENT: 'silent',
  /** 超时前发出警告，超时后发送通知。 */
  NOTIFY: 'notify',
  /** 会话永不超时。 */
  NEVER: 'never',
} as const

export type TimeoutMode = (typeof TimeoutMode)[keyof typeof TimeoutMode]
