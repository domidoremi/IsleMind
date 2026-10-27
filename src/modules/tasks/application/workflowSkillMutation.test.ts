import { createWorkflowSkillPolicy, type WorkflowSkillPolicyDependencies } from './workflowSkillPolicy'
import type { SkillDefinition } from '@/types/skillContracts'

const original: SkillDefinition = {
  schema: 'islemind.skill.v1', id: 'workflow-skill', name: 'Reviewed workflow',
  layer: 'base', systemPrompt: 'Saved workflow', priority: 0,
  tags: ['agent-workflow', 'workflow:local', 'workflow-status:enabled', 'approval:user-visible'],
  createdAt: 1, updatedAt: 2,
}

function fixture() {
  const listSkills = jest.fn().mockResolvedValue([original])
  const upsertSkill = jest.fn().mockImplementation(async skill => skill)
  const policy = createWorkflowSkillPolicy({
    workflowDefinitionPolicy: {} as WorkflowSkillPolicyDependencies['workflowDefinitionPolicy'],
    persistence: { listSkills, upsertSkill }, now: () => 3,
    redactSensitiveText: value => value, clampWorkflowOutput: (value, limit) => value.slice(0, limit),
    formatToolRequestIdentity: request => request?.toolId ?? '', resolveUniqueManifest: () => undefined,
  })
  return { policy, listSkills, upsertSkill }
}

it('binds a confirmed workflow state change to the shown skill rather than silently adopting a competing edit', async () => {
  const f = fixture()
  f.listSkills.mockResolvedValue([{ ...original, systemPrompt: 'Concurrent workflow' }])
  f.upsertSkill.mockRejectedValue(Object.assign(new Error('changed'), { name: 'ConversationSkillConflictError' }))
  await expect(f.policy.saveApprovedWorkflowSkillState({
    skill: original, state: 'disabled', approval: { approved: true },
  })).rejects.toMatchObject({ name: 'ConversationSkillConflictError' })
  expect(f.upsertSkill).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ expectedSkill: original }))
})

it('does not enable or disable a workflow after its pending local read is cancelled', async () => {
  const f = fixture()
  let resolve!: (skills: SkillDefinition[]) => void
  f.listSkills.mockImplementationOnce(() => new Promise<SkillDefinition[]>(settle => { resolve = settle }))
  const controller = new AbortController()
  const pending = f.policy.saveApprovedWorkflowSkillState({
    skill: original, state: 'disabled', approval: { approved: true }, signal: controller.signal,
  })
  controller.abort()
  resolve([original])
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(f.upsertSkill).not.toHaveBeenCalled()
})
