export interface ConversationRagCitationLike {
  readonly id: string
  readonly chunkId?: string
  readonly url?: string
  readonly label?: string
  readonly title?: string
  readonly excerpt?: string
}

export interface ConversationRagMessageLike {
  readonly role: string
}

export interface ConversationRagConversationLike {
  readonly messages: readonly ConversationRagMessageLike[]
}

export interface ConversationRagPlanLike {
  readonly query: string
  readonly enabledTechniques: readonly string[]
}

export interface ConversationRagQualityLike {
  readonly sourceCount: number
  readonly citationCoverage: number
  readonly contextPrecision: number
  readonly compressionRatio: number
  readonly confidence: number
  readonly activeRetrievals: number
  readonly missingEvidence: boolean
  readonly warnings: string[]
  readonly candidateCount?: number
  readonly generationConfidence?: number
  readonly factualClaimCount?: number
  readonly citedClaimCount?: number
  readonly unsupportedClaimCount?: number
  readonly flareTriggered?: boolean
  readonly fallbackReasons?: string[]
  readonly latencyMs?: number
  readonly tokenBudget?: number
  readonly estimatedContextTokens?: number
}

export interface ConversationRagGenerationVerification {
  readonly confidence: number
  readonly factualClaimCount: number
  readonly citedClaimCount: number
  readonly unsupportedClaimCount: number
  readonly needsFlare: boolean
  readonly reasons: readonly string[]
  readonly followupQuery?: string
}

export type ConversationRagTraceStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'error'
  | 'skipped'
  | 'cancelled'

export interface ConversationRagTraceInput {
  readonly id: string
  readonly type: 'retrieval'
  readonly title: string
  readonly content?: string
  readonly status: ConversationRagTraceStatus
  readonly startedAt: number
  readonly completedAt?: number
  readonly durationMs?: number
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface ConversationRagSupplementalTraceLike {
  readonly id: string
  readonly stage: string
  readonly title: string
  readonly content?: string
  readonly status: ConversationRagTraceStatus
  readonly startedAt: number
  readonly completedAt?: number
  readonly durationMs?: number
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface ConversationRagSupplementalRetrievalInput<TConversation> {
  readonly conversation: TConversation
  readonly query: string
  readonly followupQuery: string
  readonly excludeChunkIds: string[]
  readonly limit: 4
  readonly signal: AbortSignal
}

export interface ConversationRagSupplementalRetrievalResult<
  TSource,
  TRawTrace extends ConversationRagSupplementalTraceLike,
> {
  readonly sources: TSource[]
  readonly prompt: string
  readonly trace: readonly TRawTrace[]
}

export interface ConversationRagEvaluationQuality extends ConversationRagQualityLike {
  readonly generationConfidence: number
  readonly factualClaimCount: number
  readonly citedClaimCount: number
  readonly unsupportedClaimCount: number
  readonly flareTriggered: boolean
}

export interface ConversationRagEvaluationLogInput<TPlan> {
  readonly query: string
  readonly plan?: TPlan
  readonly quality: ConversationRagEvaluationQuality
  readonly sourceCount: number
  readonly flareTriggered: boolean
  readonly fallbackReasons?: string[]
}

export type ConversationRagFinalizationTextKey =
  | 'chatRunner.trace.ragVerifyTitle'
  | 'chatRunner.trace.ragVerifyContent'
  | 'chatRunner.trace.flareTitle'
  | 'chatRunner.trace.flareEvidenceAttached'
  | 'chatRunner.trace.flareFailed'
  | 'chatRunner.trace.ragEvaluateTitle'
  | 'chatRunner.trace.ragEvaluateContent'
  | 'chatRunner.trace.flareYes'
  | 'chatRunner.trace.flareNo'

export interface ConversationRagFinalizationRuntimeDependencies<
  TConversation extends ConversationRagConversationLike,
  TCitation extends ConversationRagCitationLike,
  TSource extends TCitation,
  TPlan extends ConversationRagPlanLike,
  TQuality extends ConversationRagQualityLike,
  TVerification extends ConversationRagGenerationVerification,
  TRawTrace extends ConversationRagSupplementalTraceLike,
  TTrace,
> {
  verifyGeneration(input: {
    readonly answer: string
    readonly query: string
    readonly citations: TCitation[]
    readonly quality?: TQuality
  }): TVerification
  retrieveSupplementalEvidence(
    input: ConversationRagSupplementalRetrievalInput<TConversation>,
  ): Promise<ConversationRagSupplementalRetrievalResult<TSource, TRawTrace>>
  logEvaluation(input: ConversationRagEvaluationLogInput<TPlan>): Promise<void>
  now(): number
  traceId(prefix: string): string
  buildTrace(input: ConversationRagTraceInput): TTrace
  completeTrace(trace: TTrace): TTrace
  recordTrace(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly trace: TTrace
  }): void
  translate(
    key: ConversationRagFinalizationTextKey,
    parameters?: Readonly<Record<string, unknown>>,
    fallback?: string,
  ): string
}

export interface ConversationRagInitialGenerationInput<
  TCitation extends ConversationRagCitationLike,
  TQuality extends ConversationRagQualityLike,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly answer: string
  readonly query: string
  readonly citations: TCitation[]
  readonly quality?: TQuality
}

export type ConversationRagSupplementalEvidenceSkipReason =
  | 'verification_not_needed'
  | 'technique_disabled'
  | 'latest_message_not_user'
  | 'request_aborted'

export interface ConversationRagSupplementalEvidenceInput<
  TConversation extends ConversationRagConversationLike,
  TCitation extends ConversationRagCitationLike,
  TSource extends TCitation,
  TPlan extends ConversationRagPlanLike,
  TVerification extends ConversationRagGenerationVerification,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly conversation: TConversation
  readonly plan?: TPlan
  readonly contextSources: readonly TSource[]
  readonly citations: TCitation[]
  readonly verification: TVerification
  readonly signal: AbortSignal
}

export interface ConversationRagSupplementalEvidenceCompleted<
  TCitation,
  TSource,
> {
  readonly status: 'completed'
  readonly sources: TSource[]
  readonly citations: TCitation[]
  readonly evidenceAttached: boolean
}

export interface ConversationRagSupplementalEvidenceSkipped<
  TCitation,
  TSource,
> {
  readonly status: 'skipped'
  readonly reason: ConversationRagSupplementalEvidenceSkipReason
  readonly sources: TSource[]
  readonly citations: TCitation[]
}

export interface ConversationRagSupplementalEvidenceFailed<
  TCitation,
  TSource,
> {
  readonly status: 'failed'
  readonly error: unknown
  readonly sources: TSource[]
  readonly citations: TCitation[]
}

export type ConversationRagSupplementalEvidenceOutcome<TCitation, TSource> =
  | ConversationRagSupplementalEvidenceCompleted<TCitation, TSource>
  | ConversationRagSupplementalEvidenceSkipped<TCitation, TSource>
  | ConversationRagSupplementalEvidenceFailed<TCitation, TSource>

export interface ConversationRagEvaluationInput<
  TCitation extends ConversationRagCitationLike,
  TSource extends TCitation,
  TPlan extends ConversationRagPlanLike,
  TQuality extends ConversationRagQualityLike,
  TVerification extends ConversationRagGenerationVerification,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly conversationTitle: string
  readonly plan?: TPlan
  readonly quality?: TQuality
  readonly initialSourceCount: number
  readonly finalCitations: readonly TCitation[]
  readonly supplementalSources: readonly TSource[]
  readonly verification: TVerification
}

/**
 * Owns the Knowledge-specific stages around ordinary conversation finalization.
 * Provider/tool revision and terminal message sequencing remain caller-owned.
 */
export function createConversationRagFinalizationRuntime<
  TConversation extends ConversationRagConversationLike,
  TCitation extends ConversationRagCitationLike,
  TSource extends TCitation,
  TPlan extends ConversationRagPlanLike,
  TQuality extends ConversationRagQualityLike,
  TVerification extends ConversationRagGenerationVerification,
  TRawTrace extends ConversationRagSupplementalTraceLike,
  TTrace,
>(
  dependencies: ConversationRagFinalizationRuntimeDependencies<
    TConversation,
    TCitation,
    TSource,
    TPlan,
    TQuality,
    TVerification,
    TRawTrace,
    TTrace
  >,
) {
  function verifyInitialGeneration(
    input: ConversationRagInitialGenerationInput<TCitation, TQuality>,
  ): TVerification {
    const verification = dependencies.verifyGeneration({
      answer: input.answer,
      query: input.query,
      citations: input.citations,
      quality: input.quality,
    })

    recordCompleted(input, {
      id: dependencies.traceId('rag-generation-verify'),
      type: 'retrieval',
      title: dependencies.translate('chatRunner.trace.ragVerifyTitle'),
      content: dependencies.translate('chatRunner.trace.ragVerifyContent', {
        confidence: Math.round(verification.confidence * 100),
        claims: verification.factualClaimCount,
        unsupported: verification.unsupportedClaimCount,
      }),
      status: verification.needsFlare ? 'skipped' : 'done',
      startedAt: dependencies.now(),
      metadata: {
        confidence: verification.confidence,
        factualClaimCount: verification.factualClaimCount,
        citedClaimCount: verification.citedClaimCount,
        unsupportedClaimCount: verification.unsupportedClaimCount,
        needsFlare: verification.needsFlare,
        reasons: verification.reasons,
        ...(verification.followupQuery === undefined
          ? {}
          : { followupQuery: verification.followupQuery }),
      },
    })

    return verification
  }

  async function resolveSupplementalEvidence(
    input: ConversationRagSupplementalEvidenceInput<
      TConversation,
      TCitation,
      TSource,
      TPlan,
      TVerification
    >,
  ): Promise<ConversationRagSupplementalEvidenceOutcome<TCitation, TSource>> {
    const skipReason = resolveSupplementalEvidenceSkipReason(input)
    if (skipReason) {
      return {
        status: 'skipped',
        reason: skipReason,
        sources: [],
        citations: input.citations,
      }
    }

    const plan = input.plan!
    const startedAt = dependencies.now()
    try {
      const supplemental = await dependencies.retrieveSupplementalEvidence({
        conversation: input.conversation,
        query: plan.query,
        followupQuery: input.verification.followupQuery ?? plan.query,
        excludeChunkIds: input.contextSources
          .map((source) => source.chunkId)
          .filter((id): id is string => Boolean(id)),
        limit: 4,
        signal: input.signal,
      })

      for (const rawTrace of supplemental.trace) {
        recordCompleted(input, {
          id: rawTrace.id,
          type: 'retrieval',
          title: rawTrace.title,
          content: rawTrace.content,
          status: rawTrace.status,
          startedAt: rawTrace.startedAt,
          completedAt: rawTrace.completedAt,
          durationMs: rawTrace.durationMs,
          metadata: {
            stage: rawTrace.stage,
            ...(rawTrace.metadata ?? {}),
          },
        })
      }

      if (!supplemental.prompt || !supplemental.sources.length) {
        return {
          status: 'completed',
          sources: supplemental.sources,
          citations: input.citations,
          evidenceAttached: false,
        }
      }

      const citations = dedupeCitations<TCitation>([
        ...input.citations,
        ...supplemental.sources,
      ])
      recordCompleted(input, {
        id: dependencies.traceId('flare-evidence'),
        type: 'retrieval',
        title: dependencies.translate('chatRunner.trace.flareTitle'),
        content: dependencies.translate(
          'chatRunner.trace.flareEvidenceAttached',
          { count: supplemental.sources.length },
          `FLARE retrieved ${supplemental.sources.length} extra evidence sources. The first model answer is kept to avoid an additional hidden chat completion.`,
        ),
        status: 'done',
        startedAt,
        metadata: {
          sourceCount: supplemental.sources.length,
          reasons: input.verification.reasons,
          revisionSkipped: true,
        },
      })
      return {
        status: 'completed',
        sources: supplemental.sources,
        citations,
        evidenceAttached: true,
      }
    } catch (error) {
      recordCompleted(input, {
        id: dependencies.traceId('flare-error'),
        type: 'retrieval',
        title: dependencies.translate('chatRunner.trace.flareTitle'),
        content: error instanceof Error
          ? error.message
          : dependencies.translate('chatRunner.trace.flareFailed'),
        status: 'error',
        startedAt,
        metadata: { reasons: input.verification.reasons },
      })
      return {
        status: 'failed',
        error,
        sources: [],
        citations: input.citations,
      }
    }
  }

  function recordEvaluation(
    input: ConversationRagEvaluationInput<
      TCitation,
      TSource,
      TPlan,
      TQuality,
      TVerification
    >,
  ): void {
    const sourceCount = input.initialSourceCount + input.supplementalSources.length
    const flareTriggered = input.supplementalSources.length > 0
    const quality: ConversationRagEvaluationQuality = {
      ...(input.quality ?? {
        sourceCount: input.initialSourceCount,
        citationCoverage: input.finalCitations.length ? 1 : 0,
        contextPrecision: 0,
        compressionRatio: 1,
        confidence: input.verification.confidence,
        activeRetrievals: 1,
        missingEvidence: false,
        warnings: [],
      }),
      generationConfidence: input.verification.confidence,
      factualClaimCount: input.verification.factualClaimCount,
      citedClaimCount: input.verification.citedClaimCount,
      unsupportedClaimCount: input.verification.unsupportedClaimCount,
      flareTriggered,
    }

    void dependencies.logEvaluation({
      query: input.plan?.query ?? input.conversationTitle,
      plan: input.plan,
      quality,
      sourceCount,
      flareTriggered,
      fallbackReasons: input.quality?.fallbackReasons,
    }).catch(() => undefined)

    recordCompleted(input, {
      id: dependencies.traceId('rag-evaluate'),
      type: 'retrieval',
      title: dependencies.translate('chatRunner.trace.ragEvaluateTitle'),
      content: dependencies.translate('chatRunner.trace.ragEvaluateContent', {
        sources: sourceCount,
        confidence: Math.round(input.verification.confidence * 100),
        flare: flareTriggered
          ? dependencies.translate('chatRunner.trace.flareYes')
          : dependencies.translate('chatRunner.trace.flareNo'),
      }),
      status: 'done',
      startedAt: dependencies.now(),
      metadata: {
        stage: 'evaluate',
        sourceCount,
        confidence: input.verification.confidence,
        flareTriggered,
        fallbackReasons: input.quality?.fallbackReasons,
      },
    })
  }

  function recordCompleted(
    input: { readonly conversationId: string; readonly assistantMessageId: string },
    trace: ConversationRagTraceInput,
  ): void {
    dependencies.recordTrace({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      trace: dependencies.completeTrace(dependencies.buildTrace(trace)),
    })
  }

  return {
    verifyInitialGeneration,
    resolveSupplementalEvidence,
    recordEvaluation,
  }
}

function resolveSupplementalEvidenceSkipReason<
  TConversation extends ConversationRagConversationLike,
  TCitation extends ConversationRagCitationLike,
  TSource extends TCitation,
  TPlan extends ConversationRagPlanLike,
  TVerification extends ConversationRagGenerationVerification,
>(
  input: ConversationRagSupplementalEvidenceInput<
    TConversation,
    TCitation,
    TSource,
    TPlan,
    TVerification
  >,
): ConversationRagSupplementalEvidenceSkipReason | undefined {
  if (!input.verification.needsFlare) return 'verification_not_needed'
  if (!input.plan?.enabledTechniques.includes('flare')) return 'technique_disabled'
  if (input.conversation.messages.at(-1)?.role !== 'user') return 'latest_message_not_user'
  if (input.signal.aborted) return 'request_aborted'
  return undefined
}

function dedupeCitations<TCitation extends ConversationRagCitationLike>(
  citations: TCitation[],
): TCitation[] {
  const unique = new Map<string, TCitation>()
  for (const citation of citations) {
    const key = citation.chunkId ?? citation.url ?? citation.id
    if (!unique.has(key)) unique.set(key, citation)
  }
  return Array.from(unique.values())
}
