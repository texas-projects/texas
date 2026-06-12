/** 帮助文档模板 —— 渲染功能列表页面。 */

import { registerTemplate } from '../templates.js'
import type { SatoriElement, TemplateFunction } from '../types.js'

export interface HelpData {
  title: string
  categories: { tag: string; items: { name: string; desc: string }[] }[]
  page: number
  totalPages: number
}

const helpTemplate: TemplateFunction<HelpData> = (data): SatoriElement => ({
  type: 'div',
  props: {
    style: {
      display: 'flex',
      flexDirection: 'column',
      padding: '24px',
      gap: '16px',
      fontFamily: 'Noto Sans CJK SC, Noto Sans, sans-serif',
      backgroundColor: '#ffffff',
    },
    children: [
      {
        type: 'div',
        props: {
          style: { fontSize: '24px', fontWeight: 'bold', color: '#24292e' },
          children: data.title,
        },
      },
      ...data.categories.flatMap((cat) => [
        {
          type: 'div',
          props: {
            style: { fontSize: '18px', fontWeight: '600', color: '#24292e', marginTop: '8px' },
            children: cat.tag,
          },
        },
        ...cat.items.map((item) => ({
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '12px' },
            children: [
              {
                type: 'span',
                props: { style: { fontWeight: 'bold', fontSize: '15px' }, children: item.name },
              },
              {
                type: 'span',
                props: { style: { color: '#586069', fontSize: '14px' }, children: item.desc },
              },
            ],
          },
        })),
      ]),
      ...(data.totalPages > 1
        ? [
            {
              type: 'div',
              props: {
                style: {
                  fontSize: '13px',
                  color: '#6a737d',
                  borderTop: '1px solid #e1e4e8',
                  paddingTop: '12px',
                },
                children: `第 ${String(data.page)} 页 / 共 ${String(data.totalPages)} 页`,
              },
            },
          ]
        : []),
    ],
  },
})

// 模块加载时自注册，无需中央配置
registerTemplate('help', helpTemplate as TemplateFunction)
