/**
 * LLM 业务逻辑层 —— 提供商/模型 CRUD 与 LLM 调用编排。
 */

import { logger, type Logger } from '@logger'

import type { LlmModel, LlmProvider } from '#prisma/main'

import { LLMClient } from './client.js'
import type { ChatMessage } from './completion.js'
import {
  maskApiKey,
  type CreateModelData,
  type CreateProviderData,
  type UpdateModelData,
  type UpdateProviderData,
} from './schemas.js'

import type { MainPrismaClient } from '@/core/db/client.js'
import { NotFoundError } from '@/core/errors.js'
import { Shutdown, Startup } from '@/core/lifecycle/registry.js'

export type { LlmProvider, LlmModel }

/** 提供商响应 DTO。 */
export interface ProviderDto {
  id: string
  name: string
  apiBase: string
  apiKeyMasked: string
  maxRetries: number
  timeout: number
  retryInterval: number
  modelCount: number
  models?: ModelDto[]
}

/** 模型响应 DTO。 */
export interface ModelDto {
  id: string
  providerId: string
  providerName: string
  modelName: string
  displayName: string | null
  inputPrice: number
  outputPrice: number
  temperature: number
  maxTokens: number | null
  forceStream: boolean
  extraParams: Record<string, unknown>
}

/** 对话选项。 */
export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  stream?: boolean
}

/**
 * LLM 核心服务 —— 封装提供商/模型 CRUD、调用编排。
 *
 * 通过 Startup / Shutdown 注册生命周期。
 */
export class LLMService {
  private readonly client: LLMClient
  private readonly _log: Logger = logger.child({ name: 'LLMService' })

  constructor(private readonly mainDb: MainPrismaClient) {
    this.client = new LLMClient()
  }

  // ══════════════════════════════════════════════
  //  提供商 CRUD
  // ══════════════════════════════════════════════

  /** 列出所有提供商（含模型数量）。 */
  async listProviders(limit = 200): Promise<ProviderDto[]> {
    const providers = await this.mainDb.llmProvider.findMany({
      include: { models: true },
      orderBy: { name: 'asc' },
      take: limit,
    })
    return providers.map((p) => this._providerToDto(p, p.models))
  }

  /** 获取单个提供商详情（含旗下模型列表）。 */
  async getProvider(providerId: string): Promise<ProviderDto> {
    const provider = await this.mainDb.llmProvider.findUnique({
      where: { id: providerId },
      include: { models: true },
    })
    if (!provider) throw new NotFoundError(`提供商不存在: ${providerId}`)
    const dto = this._providerToDto(provider, provider.models)
    dto.models = provider.models.map((m) => this._modelToDto(m, provider))
    return dto
  }

  /** 创建提供商。 */
  async createProvider(data: CreateProviderData): Promise<ProviderDto> {
    const provider = await this.mainDb.llmProvider.create({
      data: {
        name: data.name,
        apiBase: data.apiBase,
        apiKey: data.apiKey,
        maxRetries: data.maxRetries,
        timeout: data.timeout,
        retryInterval: data.retryInterval,
      },
    })
    this._log.info({ name: data.name }, 'LLM 提供商已创建')
    return this._providerToDto(provider, [])
  }

  /** 更新提供商（字段级部分更新）。 */
  async updateProvider(providerId: string, data: UpdateProviderData): Promise<ProviderDto> {
    const existing = await this.mainDb.llmProvider.findUnique({
      where: { id: providerId },
    })
    if (!existing) throw new NotFoundError(`提供商不存在: ${providerId}`)

    const provider = await this.mainDb.llmProvider.update({
      where: { id: providerId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.apiBase !== undefined ? { apiBase: data.apiBase } : {}),
        ...(data.apiKey !== undefined ? { apiKey: data.apiKey } : {}),
        ...(data.maxRetries !== undefined ? { maxRetries: data.maxRetries } : {}),
        ...(data.timeout !== undefined ? { timeout: data.timeout } : {}),
        ...(data.retryInterval !== undefined ? { retryInterval: data.retryInterval } : {}),
      },
      include: { models: true },
    })

    if (
      data.apiBase !== undefined ||
      data.apiKey !== undefined ||
      data.maxRetries !== undefined ||
      data.timeout !== undefined ||
      data.retryInterval !== undefined
    ) {
      this.client.invalidate(providerId)
    }

    this._log.info({ providerId }, 'LLM 提供商已更新')
    return this._providerToDto(provider, provider.models)
  }

  /** 删除提供商（级联删除旗下模型）。 */
  async deleteProvider(providerId: string): Promise<void> {
    const existing = await this.mainDb.llmProvider.findUnique({
      where: { id: providerId },
    })
    if (!existing) throw new NotFoundError(`提供商不存在: ${providerId}`)

    await this.mainDb.llmProvider.delete({ where: { id: providerId } })
    this.client.invalidate(providerId)
    this._log.info({ providerId }, 'LLM 提供商已删除')
  }

  // ══════════════════════════════════════════════
  //  模型 CRUD
  // ══════════════════════════════════════════════

  /** 列出模型（可按提供商筛选）。 */
  async listModels(providerId?: string, limit = 500): Promise<ModelDto[]> {
    const models = await this.mainDb.llmModel.findMany({
      where: providerId != null ? { providerId } : undefined,
      include: { provider: true },
      orderBy: { modelName: 'asc' },
      take: limit,
    })
    return models.map((m) => this._modelToDto(m, m.provider))
  }

  /** 获取单个模型详情。 */
  async getModel(modelId: string): Promise<ModelDto> {
    const model = await this.mainDb.llmModel.findUnique({
      where: { id: modelId },
      include: { provider: true },
    })
    if (!model) throw new NotFoundError(`模型不存在: ${modelId}`)
    return this._modelToDto(model, model.provider)
  }

  /** 创建模型。 */
  async createModel(data: CreateModelData): Promise<ModelDto> {
    const provider = await this.mainDb.llmProvider.findUnique({
      where: { id: data.providerId },
    })
    if (!provider) throw new NotFoundError(`提供商不存在: ${data.providerId}`)

    const model = await this.mainDb.llmModel.create({
      data: {
        providerId: data.providerId,
        modelName: data.modelName,
        displayName: data.displayName ?? null,
        inputPrice: data.inputPrice,
        outputPrice: data.outputPrice,
        temperature: data.temperature,
        maxTokens: data.maxTokens ?? null,
        forceStream: data.forceStream,
        extraParams: data.extraParams,
      },
      include: { provider: true },
    })
    this._log.info({ modelName: data.modelName, providerId: data.providerId }, 'LLM 模型已创建')
    return this._modelToDto(model, model.provider)
  }

  /** 更新模型（字段级部分更新）。 */
  async updateModel(modelId: string, data: UpdateModelData): Promise<ModelDto> {
    const existing = await this.mainDb.llmModel.findUnique({
      where: { id: modelId },
    })
    if (!existing) throw new NotFoundError(`模型不存在: ${modelId}`)

    const model = await this.mainDb.llmModel.update({
      where: { id: modelId },
      data: {
        ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
        ...(data.inputPrice !== undefined ? { inputPrice: data.inputPrice } : {}),
        ...(data.outputPrice !== undefined ? { outputPrice: data.outputPrice } : {}),
        ...(data.temperature !== undefined ? { temperature: data.temperature } : {}),
        ...(data.maxTokens !== undefined ? { maxTokens: data.maxTokens } : {}),
        ...(data.forceStream !== undefined ? { forceStream: data.forceStream } : {}),
        ...(data.extraParams !== undefined ? { extraParams: data.extraParams } : {}),
      },
      include: { provider: true },
    })
    this._log.info({ modelId }, 'LLM 模型已更新')
    return this._modelToDto(model, model.provider)
  }

  /** 删除模型。 */
  async deleteModel(modelId: string): Promise<void> {
    const existing = await this.mainDb.llmModel.findUnique({
      where: { id: modelId },
    })
    if (!existing) throw new NotFoundError(`模型不存在: ${modelId}`)

    await this.mainDb.llmModel.delete({ where: { id: modelId } })
    this._log.info({ modelId }, 'LLM 模型已删除')
  }

  // ══════════════════════════════════════════════
  //  LLM 调用
  // ══════════════════════════════════════════════

  /**
   * 使用指定模型名进行对话，返回完整回复文本。
   */
  async chatByName(
    modelName: string,
    messages: ChatMessage[],
    _opts: ChatOptions = {},
  ): Promise<string> {
    const model = await this.mainDb.llmModel.findFirst({
      where: { modelName, isEnabled: true },
      include: { provider: true },
    })
    if (!model) throw new NotFoundError(`找不到模型: ${modelName}`)

    const chatModel = this.client.createChatModel(model.provider, model)

    const langchainMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    const response = await chatModel.invoke(langchainMessages)

    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content)
  }

  /**
   * 流式调用 LLM，逐块 yield 文本内容。
   */
  async *chatStreamByName(
    modelName: string,
    messages: ChatMessage[],
    _opts: Omit<ChatOptions, 'stream'> = {},
  ): AsyncGenerator<string> {
    const model = await this.mainDb.llmModel.findFirst({
      where: { modelName, isEnabled: true },
      include: { provider: true },
    })
    if (!model) throw new NotFoundError(`找不到模型: ${modelName}`)

    const chatModel = this.client.createChatModel(model.provider, model)

    const langchainMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    const stream = await chatModel.stream(langchainMessages)

    for await (const chunk of stream) {
      const text = typeof chunk.content === 'string' ? chunk.content : ''
      if (text) yield text
    }
  }

  /** 释放内部资源。 */
  close(): void {
    this.client.clear()
  }

  // ══════════════════════════════════════════════
  //  内部辅助
  // ══════════════════════════════════════════════

  private _providerToDto(provider: LlmProvider, models: LlmModel[]): ProviderDto {
    return {
      id: provider.id,
      name: provider.name,
      apiBase: provider.apiBase,
      apiKeyMasked: maskApiKey(provider.apiKey),
      maxRetries: provider.maxRetries,
      timeout: provider.timeout,
      retryInterval: provider.retryInterval,
      modelCount: models.length,
    }
  }

  private _modelToDto(model: LlmModel, provider: LlmProvider): ModelDto {
    return {
      id: model.id,
      providerId: model.providerId,
      providerName: provider.name,
      modelName: model.modelName,
      displayName: model.displayName,
      inputPrice: Number(model.inputPrice),
      outputPrice: Number(model.outputPrice),
      temperature: model.temperature,
      maxTokens: model.maxTokens,
      forceStream: model.forceStream,
      extraParams: model.extraParams as Record<string, unknown>,
    }
  }
}

// ── 生命周期注册 ──

Startup({ name: 'llm', provides: ['llm_service'], requires: ['main_db'] })(async function (
  deps: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const mainDb = deps.main_db as MainPrismaClient
  const service = new LLMService(mainDb)
  return { llm_service: service }
})

Shutdown({ name: 'llm' })(async function (services: Record<string, unknown>): Promise<void> {
  const svc = services.llm_service as LLMService | undefined
  svc?.close()
})
