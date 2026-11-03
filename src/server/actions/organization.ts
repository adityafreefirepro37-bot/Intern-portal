'use server'

import { revalidatePath } from 'next/cache'
import { requireApiContext } from '../context'
import { organizationStructureService } from '../services/organization-structure.service'
import { formError, formFields, safeValues, type FormState } from './form-state'

/**
 * Organization structure: departments, teams and positions. The browser sends
 * ids and values only; permissions, uniqueness, leaders and archive rules are
 * enforced by organizationStructureService.
 */

async function run(
  formData: FormData,
  operation: (fields: Record<string, string>) => Promise<string>,
): Promise<FormState> {
  const fields = formFields(formData)
  try {
    const message = await operation(fields)
    revalidatePath('/teams')
    return { status: 'success', message }
  } catch (error) {
    return formError(error, safeValues(fields))
  }
}

const archiveMessage = (label: string, fields: Record<string, string>) =>
  fields.active === 'true' ? `${label} restored.` : `${label} archived.`

export async function saveDepartmentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await organizationStructureService.saveDepartment(await requireApiContext(), fields)
    return 'Department saved.'
  })
}

export async function setDepartmentActiveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await organizationStructureService.setActive(await requireApiContext(), 'department', fields)
    return archiveMessage('Department', fields)
  })
}

export async function saveTeamAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await organizationStructureService.saveTeam(await requireApiContext(), fields)
    return 'Team saved.'
  })
}

export async function setTeamActiveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await organizationStructureService.setActive(await requireApiContext(), 'team', fields)
    return archiveMessage('Team', fields)
  })
}

export async function savePositionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await organizationStructureService.savePosition(await requireApiContext(), fields)
    return 'Position saved.'
  })
}

export async function setPositionActiveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await organizationStructureService.setActive(await requireApiContext(), 'position', fields)
    return archiveMessage('Position', fields)
  })
}
