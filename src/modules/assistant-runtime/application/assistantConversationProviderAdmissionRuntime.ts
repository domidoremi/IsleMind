export interface AssistantConversationProviderAdmissionConversationLike {
  readonly model: string
}

export interface AssistantConversationProviderAdmissionProviderLike {
  readonly id: string
}

export interface AssistantConversationProviderAdmissionCancelled {
  readonly kind: 'cancelled'
}

export interface AssistantConversationProviderAdmissionSetupRequired {
  readonly kind: 'setup_required'
}

export interface AssistantConversationProviderAdmissionRejected<TErrorCode> {
  readonly kind: 'rejected'
  readonly reason: string
  readonly code: TErrorCode
  readonly providerId?: string
  readonly messageKey?: string
  readonly fallback?: string
}

export interface AssistantConversationProviderAdmissionFailed<TErrorCode> {
  readonly kind: 'failed'
  readonly code: TErrorCode
  readonly providerId: string
}

export interface AssistantConversationProviderAdmissionReady<
  TConversation,
  TProvider,
  TModelConfig,
> {
  readonly kind: 'ready'
  readonly conversation: TConversation
  readonly provider: TProvider
  readonly upstreamModel: string
  readonly modelConfig: TModelConfig
}

export type AssistantConversationProviderAdmissionPortOutcome<
  TConversation,
  TProvider,
  TModelConfig,
  TErrorCode,
> =
  | AssistantConversationProviderAdmissionCancelled
  | AssistantConversationProviderAdmissionSetupRequired
  | AssistantConversationProviderAdmissionRejected<TErrorCode>
  | AssistantConversationProviderAdmissionFailed<TErrorCode>
  | AssistantConversationProviderAdmissionReady<
      TConversation,
      TProvider,
      TModelConfig
    >

export interface AssistantConversationProviderAdmissionInput<
  TConversation,
  TProviders,
  TSettings,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly conversation: TConversation
  readonly providers: TProviders
  readonly settings: TSettings
  readonly signal: AbortSignal
}

export interface AssistantConversationProviderAdmissionRuntimeDependencies<
  TConversation extends AssistantConversationProviderAdmissionConversationLike,
  TProvider extends AssistantConversationProviderAdmissionProviderLike,
  TProviders extends readonly TProvider[],
  TSettings,
  TModelConfig,
  TErrorCode,
  TTrace,
> {
  admitConversation(input: {
    readonly conversation: TConversation
    readonly providers: TProviders
    readonly settings: TSettings
    readonly signal: AbortSignal
  }): Promise<AssistantConversationProviderAdmissionPortOutcome<
    TConversation,
    TProvider,
    TModelConfig,
    TErrorCode
  >>
  buildSetupGuide(): string
  translate(
    key: string,
    parameters?: Readonly<Record<string, unknown>>,
    fallback?: string,
  ): string
  projectTerminalFailure(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly content: string
    readonly errorCode: TErrorCode
    readonly providerId?: string
  }): void
  buildCompatibilityTrace(input: {
    readonly conversationId: string
    readonly provider: TProvider
    readonly model: string
    readonly requestedModel: string
    readonly settings: TSettings
  }): TTrace
  recordTrace(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly trace: TTrace
  }): void
  missingKeyErrorCode: TErrorCode
}

export type AssistantConversationProviderAdmissionOutcome<
  TConversation,
  TProvider,
  TModelConfig,
  TErrorCode,
> =
  | AssistantConversationProviderAdmissionCancelled
  | {
      readonly kind: 'projected_failure'
      readonly source: 'setup_required' | 'rejected' | 'failed'
      readonly admission:
        | AssistantConversationProviderAdmissionSetupRequired
        | AssistantConversationProviderAdmissionRejected<TErrorCode>
        | AssistantConversationProviderAdmissionFailed<TErrorCode>
    }
  | AssistantConversationProviderAdmissionReady<
      TConversation,
      TProvider,
      TModelConfig
    >

/**
 * Maps Providers-owned ordinary-conversation admission outcomes into terminal
 * conversation effects and projects compatibility evidence only after a ready
 * outcome. Concrete admission, localization, and store effects stay injected.
 */
export function createAssistantConversationProviderAdmissionRuntime<
  TConversation extends AssistantConversationProviderAdmissionConversationLike,
  TProvider extends AssistantConversationProviderAdmissionProviderLike,
  TProviders extends readonly TProvider[],
  TSettings,
  TModelConfig,
  TErrorCode,
  TTrace,
>(
  dependencies: AssistantConversationProviderAdmissionRuntimeDependencies<
    TConversation,
    TProvider,
    TProviders,
    TSettings,
    TModelConfig,
    TErrorCode,
    TTrace
  >,
) {
  async function admit(
    input: AssistantConversationProviderAdmissionInput<
      TConversation,
      TProviders,
      TSettings
    >,
  ): Promise<AssistantConversationProviderAdmissionOutcome<
    TConversation,
    TProvider,
    TModelConfig,
    TErrorCode
  >> {
    const admission = await dependencies.admitConversation({
      conversation: input.conversation,
      providers: input.providers,
      settings: input.settings,
      signal: input.signal,
    })
    if (admission.kind === 'cancelled') return admission

    if (admission.kind === 'setup_required') {
      dependencies.projectTerminalFailure({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        content: dependencies.buildSetupGuide(),
        errorCode: dependencies.missingKeyErrorCode,
      })
      return {
        kind: 'projected_failure',
        source: 'setup_required',
        admission,
      }
    }

    if (admission.kind === 'rejected') {
      dependencies.projectTerminalFailure({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        content: rejectionContent(admission),
        errorCode: admission.code,
        providerId: admission.providerId,
      })
      return {
        kind: 'projected_failure',
        source: 'rejected',
        admission,
      }
    }

    if (admission.kind === 'failed') {
      dependencies.projectTerminalFailure({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        content: dependencies.translate('chatRunner.error.sendFailed'),
        errorCode: admission.code,
        providerId: admission.providerId,
      })
      return {
        kind: 'projected_failure',
        source: 'failed',
        admission,
      }
    }

    dependencies.recordTrace({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      trace: dependencies.buildCompatibilityTrace({
        conversationId: input.conversationId,
        provider: admission.provider,
        model: admission.upstreamModel,
        requestedModel: admission.conversation.model,
        settings: input.settings,
      }),
    })
    return admission
  }

  function rejectionContent(
    admission: AssistantConversationProviderAdmissionRejected<TErrorCode>,
  ): string {
    if (admission.reason === 'disabled_provider') {
      return dependencies.translate('chatRunner.error.providerDisabled')
    }
    if (admission.reason === 'model_unavailable') {
      return dependencies.translate('chatRunner.userError.modelUnavailable')
    }
    if (admission.reason === 'missing_key') {
      return dependencies.translate('chatRunner.error.missingKey')
    }
    return dependencies.translate(
      admission.messageKey ?? admission.fallback ?? '',
      undefined,
      admission.fallback,
    )
  }

  return { admit }
}
