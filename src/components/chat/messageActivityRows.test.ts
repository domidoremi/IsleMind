import { createInstance } from 'i18next'
import type { Message } from '@/types/chatContracts'
import type { ProcessTrace } from '@/core'
import { createResponseLifecycle, transitionResponseLifecycle } from '@/modules/conversations'
import zhCN from '@/i18n/resources/zh-CN.json'
import { collectMessageActivityRows, messageActivityLabel } from './messageActivityRows'
import { normalizeTraceStatuses } from './tracePresentation'

const i18n = createInstance()
const message: Message = { id: 'reply', role: 'assistant', content: '', status: 'streaming', timestamp: 100 }
const tool = (id: string, startedAt: number, status: ProcessTrace['status'] = 'running'): ProcessTrace => ({
  id, type: 'tool', title: 'Command', status, startedAt,
  metadata: { toolName: 'exec_command', inputSummary: 'echo hello' },
})
beforeAll(async () => { await i18n.init({ lng: 'zh-CN', interpolation: { escapeValue: false }, resources: { 'zh-CN': { translation: zhCN } } }) })

it('keeps a paused lifecycle visible without calling unsettled work running or successful', () => {
  const lifecycle = transitionResponseLifecycle(createResponseLifecycle(100, 'working'), 'paused', 200, {
    summary: 'The request cannot be admitted safely.',
  })
  const rows = collectMessageActivityRows({ ...message, responseLifecycle: lifecycle }, [
    { ...tool('unsettled', 120), content: 'Partial receipt; no durable outcome.' },
  ])
  const pause = rows.find(row => row.kind === 'paused')
  expect(pause).toMatchObject({ state: 'paused', details: [{ kind: 'summary', text: 'The request cannot be admitted safely.' }] })
  expect(messageActivityLabel(pause!, i18n.t)).toBe(i18n.t('agentTasks.status.paused'))
  expect(rows.find(row => row.id === 'trace:unsettled')?.state).toBe('incomplete')
  expect(rows.some(row => row.state === 'running')).toBe(false)
})

it.each(['error', 'cancelled', 'done'] as const)('does not invent success from partial output and an end timestamp (%s)', status => {
  const trace = { ...tool('partial', 100), completedAt: 150, content: 'partial output' }
  expect(normalizeTraceStatuses([trace], status)[0].status).not.toBe('done')
  expect(collectMessageActivityRows({ ...message, status }, [trace])[0].state).not.toBe('done')
})

it('cancellation wins over stale pending-permission metadata', () => {
  const rows = collectMessageActivityRows({ ...message, status: 'cancelled' }, [
    { ...tool('pending', 100, 'pending'), metadata: { errorCode: 'permission_required' } },
  ])
  expect(rows[0].state).toBe('cancelled')
  expect(messageActivityLabel(rows[0], i18n.t)).toContain('已取消')
})

it('updates real stages in place with completed wording, without inventing absent stages', () => {
  let lifecycle = createResponseLifecycle(100)
  let rows = collectMessageActivityRows({ ...message, responseLifecycle: lifecycle }, [])
  const id = rows[0].id
  expect(messageActivityLabel(rows[0], i18n.t)).toBe('正在准备回复')
  lifecycle = transitionResponseLifecycle(lifecycle, 'sending', 120)
  rows = collectMessageActivityRows({ ...message, responseLifecycle: lifecycle }, [])
  expect(rows.map(row => messageActivityLabel(row, i18n.t))).toEqual(['回复准备完成', '正在发送请求'])
  expect(rows[0].id).toBe(id)
  lifecycle = transitionResponseLifecycle(lifecycle, 'waiting', 150)
  lifecycle = transitionResponseLifecycle(lifecycle, 'working', 300)
  lifecycle = transitionResponseLifecycle(lifecycle, 'completed', 350)
  rows = collectMessageActivityRows({ ...message, status: 'done', content: 'Reply', responseLifecycle: lifecycle }, [])
  expect(rows.map(row => messageActivityLabel(row, i18n.t))).toEqual(['回复准备完成', '请求已发送', '已收到模型响应', '相关信息处理完成'])
  expect(rows.every(row => row.details.length === 0)).toBe(true)
})

it('omits unused capability manifests and disabled retrieval, including their linked lifecycle entries', () => {
  const traces: ProcessTrace[] = [
    { id: 'mcp-manifest-1', type: 'tool', title: 'Tools', status: 'done', metadata: { connected: 5 } },
    { id: 'provider-tools-skip-1', type: 'tool', title: 'Tools', status: 'skipped' },
    { id: 'tool-gateway-1', type: 'tool', title: 'Gateway', status: 'done' },
    { id: 'native-search-1', type: 'search', title: 'Search', status: 'skipped', metadata: { requestedMode: 'off' } },
    { id: 'memory-extract-1', type: 'memory', title: 'Memory', status: 'skipped', metadata: { transitionReason: 'memory_disabled' } },
    { id: 'context-1', type: 'retrieval', title: 'Context', status: 'done', metadata: { memoryEnabled: false, knowledgeEnabled: false, sourceCount: 0 } },
    { id: 'rag-evaluate-1', type: 'retrieval', title: 'Diagnostic', status: 'done', metadata: { sourceCount: 0 } },
    { id: 'rag-generation-verify-1', type: 'retrieval', title: 'Diagnostic', status: 'skipped', metadata: { needsFlare: true } },
  ]
  const lifecycle = transitionResponseLifecycle(createResponseLifecycle(100, 'tool_calling', { traceId: 'mcp-manifest-1' }), 'completed', 200)
  expect(collectMessageActivityRows({ ...message, status: 'done', content: 'Answer', responseLifecycle: lifecycle }, traces)).toEqual([])
})

it('retains rejected requests, actual no-hit retrieval, and failures replacing hidden preparation', () => {
  const traces: ProcessTrace[] = [
    { id: 'native-search-1', type: 'search', title: 'Search', status: 'skipped', metadata: { requestedMode: 'native', reason: 'provider_native_search_unclaimed' } },
    { id: 'context-no-hits', type: 'retrieval', title: 'Context', status: 'done', metadata: { memoryEnabled: false, knowledgeEnabled: true, sourceCount: 0 } },
    { id: 'context-error', type: 'retrieval', title: 'Context', status: 'running', metadata: { memoryEnabled: false, knowledgeEnabled: false } },
    { id: 'context-error', type: 'retrieval', title: 'Context', status: 'error', content: 'Storage failed' },
    { ...tool('provider-tools-actual', 100, 'error'), metadata: { toolId: 'edit_file', errorCode: 'permission_required' } },
  ]
  const rows = collectMessageActivityRows({ ...message, status: 'done' }, traces)
  expect(rows).toHaveLength(4)
  expect(rows.find(row => row.id === 'trace:context-error')?.state).toBe('error')
  expect(rows.find(row => row.id === 'trace:provider-tools-actual')?.state).toBe('waiting')
})

it('does not turn unused RAG follow-up and quality diagnostics into unfinished retrieval work', () => {
  // runAgenticRag records these local planning/quality steps even when the
  // actual retrieval returns no sources. No FLARE request has run yet.
  const diagnostics: ProcessTrace[] = ['plan', 'rerank', 'pack', 'flare', 'verify'].map(stage => ({
    id: `rag-qa-${stage}`, type: 'retrieval', title: `RAG ${stage}`,
    status: stage === 'flare' || stage === 'verify' ? 'skipped' : 'done',
    metadata: { stage, reason: 'missing-evidence', confidence: 0 },
  }))
  const retrieval: ProcessTrace = {
    id: 'rag-qa-retrieve', type: 'retrieval', title: 'RAG retrieve', status: 'done',
    metadata: { stage: 'retrieve', sourceCount: 0 },
  }
  const lifecycle = transitionResponseLifecycle(createResponseLifecycle(100, 'working', { traceId: 'rag-qa-verify' }), 'completed', 200)
  const rows = collectMessageActivityRows({ ...message, status: 'done', content: 'Answer', responseLifecycle: lifecycle }, [...diagnostics, retrieval])
  expect(rows.map(row => row.id)).toEqual(['trace:rag-qa-retrieve'])
  expect(rows.map(row => row.state)).toEqual(['done'])
})

it('keeps actual follow-up retrieval, rejected operations and RAG diagnostic failures visible', () => {
  const base: ProcessTrace = { id: 'rag-qa-flare', type: 'retrieval', title: 'FLARE', status: 'skipped', metadata: { stage: 'flare' } }
  const traces: ProcessTrace[] = [
    { ...base, id: 'rag-actual-flare', status: 'done' },
    { ...base, id: 'rag-pending-flare', status: 'running' },
    { ...base, id: 'rag-denied-flare', metadata: { stage: 'flare', reason: 'missing-evidence', errorCode: 'permission_required' } },
    { ...base, id: 'rag-qa-verify', status: 'error', metadata: { stage: 'verify' }, content: 'Storage failed' },
  ]
  expect(collectMessageActivityRows(message, traces).map(row => row.state)).toEqual(['done', 'running', 'waiting', 'error'])
})

it('joins thinking, tool call and result events to their own trace exactly once', () => {
  const traces: ProcessTrace[] = [
    { id: 'thinking', type: 'reasoning', title: 'Thinking', status: 'done', startedAt: 110, completedAt: 150,
      content: 'PRIVATE REASONING', metadata: { safeSummary: 'Compared the available sources.' } },
    { ...tool('command', 150, 'done'), completedAt: 250, content: 'hello' },
  ]
  let lifecycle = createResponseLifecycle(100)
  lifecycle = transitionResponseLifecycle(lifecycle, 'thinking', 110, { traceId: 'thinking' })
  lifecycle = transitionResponseLifecycle(lifecycle, 'tool_calling', 150, { traceId: 'command' })
  lifecycle = transitionResponseLifecycle(lifecycle, 'tool_result', 250, { traceId: 'command' })
  lifecycle = transitionResponseLifecycle(lifecycle, 'completed', 300)
  const rows = collectMessageActivityRows({ ...message, status: 'done', responseLifecycle: lifecycle }, traces)
  expect(rows.map(row => row.id)).toEqual(['lifecycle:preparing:100:', 'trace:thinking', 'trace:command'])
  expect(rows[1].details).toEqual([{ kind: 'summary', text: 'Compared the available sources.' }])
  expect(rows[2].details).toEqual([{ kind: 'input', text: 'echo hello' }, { kind: 'output', text: 'hello' }])
  expect(messageActivityLabel(rows[1], i18n.t)).toBe('思考已完成')
  expect(messageActivityLabel(rows[2], i18n.t)).toBe('已使用 exec_command 运行命令')
})

it('keeps parallel and repeated activities ordered by start time, not by their completion time', () => {
  const a = tool('a', 100)
  const b = { ...tool('b', 150, 'done'), completedAt: 200 }
  const before = collectMessageActivityRows(message, [b, a])
  const after = collectMessageActivityRows(message, [b, { ...a, status: 'done', completedAt: 300 }, tool('c', 310)])
  expect(before.map(row => row.id)).toEqual(['trace:a', 'trace:b'])
  expect(after.map(row => row.id)).toEqual(['trace:a', 'trace:b', 'trace:c'])
})

it.each(['error', 'cancelled'] as const)('does not mark the interrupted lifecycle stage successful on %s', status => {
  const lifecycle = transitionResponseLifecycle(createResponseLifecycle(100, 'waiting'), status, 200)
  const rows = collectMessageActivityRows({ ...message, status, responseLifecycle: lifecycle }, [])
  expect(rows).toHaveLength(1)
  expect(rows[0].state).toBe(status)
  expect(messageActivityLabel(rows[0], i18n.t)).not.toBe('已收到模型响应')
})

it.each(['error', 'cancelled', 'done'] as const)('never promotes an unfinished tool with partial output to success on message %s', status => {
  const rows = collectMessageActivityRows({ ...message, status }, [{ ...tool('a', 100), content: 'partial output' }])
  expect(rows[0].state).toBe(status === 'done' ? 'incomplete' : status)
  expect(messageActivityLabel(rows[0], i18n.t)).not.toContain('已使用')
})

it('shows pending permission as waiting, queued work as pending, and skipped work as skipped', () => {
  const traces = [
    { ...tool('permission', 100, 'error'), metadata: { toolName: 'set_theme_mode', errorCode: 'permission_required' } },
    tool('pending', 120, 'pending'), tool('skip', 130, 'skipped'),
  ]
  const rows = collectMessageActivityRows(message, traces)
  expect(rows.map(row => row.state)).toEqual(['waiting', 'pending', 'skipped'])
  expect(messageActivityLabel(rows[0], i18n.t)).toBe('运行 set_theme_mode · 等待确认')
  expect(messageActivityLabel(rows[1], i18n.t)).toBe('使用 exec_command 运行命令 · 等待执行')
})

it('distinguishes a provider tool request from a tool that actually ran', () => {
  const rows = collectMessageActivityRows(message, [{ ...tool('request', 100, 'done'), metadata: {
    toolName: 'exec_command', toolCallMode: 'native-provider', source: 'provider',
  } }])
  expect(messageActivityLabel(rows[0], i18n.t)).toBe('已请求调用 exec_command')
})

it('does not leave transport fragments as unfinished work after a successful Harness receipt', () => {
  const fragment = { ...tool('fragment', 100), metadata: { source: 'provider', clientToolCall: true, toolName: 'provider_tool' } }
  const receipt = { ...tool('receipt', 110, 'done'), metadata: { operationId: 'builtin:set_theme_mode', toolName: 'set_theme_mode' } }
  expect(collectMessageActivityRows({ ...message, status: 'done' }, [fragment, receipt]).map(row => row.state)).toEqual(['done'])
  // Actual parser errors and operation failures still require visible attention.
  expect(collectMessageActivityRows({ ...message, status: 'error' }, [{ ...fragment, status: 'error' }, receipt]).some(row => row.state === 'error')).toBe(true)
})

it('uses concrete search and edit identities rather than generic lifecycle tool labels', () => {
  const traces = [
    { ...tool('edit', 110, 'done'), metadata: { toolName: 'edit_file', filePath: 'src/app.ts' } },
    { ...tool('search', 200, 'done'), metadata: { toolName: 'web_search' }, content: 'Found three sources.' },
  ]
  const rows = collectMessageActivityRows(message, traces)
  expect(rows.map(row => messageActivityLabel(row, i18n.t))).toEqual(['已编辑 src/app.ts', '搜索完成'])
})

it('redacts secrets and drops private reasoning/protocol blocks from all details', () => {
  const rows = collectMessageActivityRows(message, [
    { id: 'raw', type: 'reasoning', title: 'Thinking', status: 'done', content: 'PRIVATE REASONING' },
    { id: 'safe', type: 'reasoning', title: 'Thinking', status: 'done', metadata: { safeSummary: '<think>PRIVATE</think>Compared sources. api_key=secret-value' } },
    { ...tool('output', 100, 'done'), metadata: { toolName: 'exec_command', inputSummary: 'password=private-password' }, content: '<reasoning>PRIVATE</reasoning>hello' },
    { ...tool('hidden', 200, 'done'), metadata: { hiddenSignature: true } },
  ])
  expect(rows.find(row => row.id === 'trace:raw')!.details).toEqual([])
  expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|secret-value|private-password|trace:hidden/)
  expect(JSON.stringify(rows)).toContain('[redacted]')
})

it('does not borrow another thinking summary or a generic model trace for a lifecycle entry', () => {
  const lifecycle = createResponseLifecycle(100, 'thinking', { traceId: 'first', summary: 'First summary.' })
  const rows = collectMessageActivityRows({ ...message, responseLifecycle: lifecycle }, [
    { id: 'second', type: 'reasoning', title: 'Thinking', status: 'done', startedAt: 200, metadata: { safeSummary: 'Second summary.' } },
    { id: 'model-request', type: 'system', title: 'Model request', status: 'done', content: 'INTERNAL CONFIG' },
  ])
  expect(rows).toHaveLength(2)
  expect(rows.map(row => row.details[0].text)).toEqual(['First summary.', 'Second summary.'])
})

it('does not present workflow bookkeeping or its step-start marker as model thinking', () => {
  const traces: ProcessTrace[] = [
    { id: 'intent', type: 'reasoning', title: 'Agent intent', status: 'done' },
    { id: 'plan', type: 'reasoning', title: 'Agent plan', status: 'done' },
    { id: 'step-start', type: 'reasoning', title: 'Execute command', status: 'running', metadata: { toolName: 'exec_command' } },
    tool('actual-command', 200, 'done'),
  ]
  const lifecycle = createResponseLifecycle(100, 'thinking', { traceId: 'step-start' })
  expect(collectMessageActivityRows({ ...message, status: 'done', responseLifecycle: lifecycle }, traces).map(row => row.kind)).toEqual(['command'])
})

it('redacts quoted, nested and truncated JSON credentials before opening tool details', () => {
  const rows = collectMessageActivityRows(message, [
    { ...tool('json', 100, 'done'), metadata: { toolName: 'exec_command', inputSummary: '{"password":"fake-private","nested":{"api_key":"fake-api-value"},"path":"app.ts"}' }, content: 'Result: {"authorization":"Basic fake-credential"}' },
    { ...tool('truncated', 200, 'done'), content: '{"secret":"fake-incomplete' },
    { ...tool('malformed', 300, 'done'), content: String.raw`Log: {"bad\q":"text","password":"fake-malformed"}` },
  ])
  expect(JSON.stringify(rows)).not.toMatch(/fake-private|fake-api-value|fake-credential|fake-incomplete|fake-malformed/)
  expect(JSON.stringify(rows)).toContain('app.ts')
})
