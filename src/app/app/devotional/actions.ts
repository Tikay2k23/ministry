'use server';

import { revalidatePath } from 'next/cache';
import { appointWorshipCoordinator, removeWorshipCoordinator } from '@/server/modules/devotional/coordinators.service';
import { createGatheringType, setRosterTemplate, updateGatheringType } from '@/server/modules/devotional/gathering-types.service';
import {
  assignServing,
  cancelGathering,
  createOneOffGathering,
  publishRosters,
  rebuildRoster,
  removeServingAssignment,
  shareServingLink,
  substituteServing,
  suggestServingSubstitutes,
  updateGatheringDetails,
} from '@/server/modules/devotional/roster.service';
import { createGatheringSchedule, endGatheringSchedule } from '@/server/modules/devotional/schedules.service';
import { createServingRole, updateServingRole } from '@/server/modules/devotional/serving-roles.service';
import { addWorshipTeamMember, createWorshipTeam, removeWorshipTeamMember, setMemberServingRoles } from '@/server/modules/devotional/teams.service';
import { addUnavailability, removeUnavailability } from '@/server/modules/devotional/unavailability.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

/**
 * Server actions for the devotional pages (docs/04 A19–A21). The services check permission and the
 * gathering type's scope on every call; these only connect the pages to them.
 */

type Service<T> = (db: ReturnType<typeof getDb>, ctx: Awaited<ReturnType<typeof requirePortal>>['ctx'], input: unknown) => Promise<T>;

async function run<T>(service: Service<T>, input: unknown, options: { changes: boolean }) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => service(getDb(), ctx, input));
  if (result.ok && options.changes) revalidatePath('/app/devotional', 'layout');
  return result;
}

// Rosters
export const assignServingAction = async (input: unknown) => run(assignServing, input, { changes: true });
export const substituteServingAction = async (input: unknown) => run(substituteServing, input, { changes: true });
export const removeServingAction = async (input: unknown) => run(removeServingAssignment, input, { changes: true });
export const publishRostersAction = async (input: unknown) => run(publishRosters, input, { changes: true });
export const rebuildRosterAction = async (input: unknown) => run(rebuildRoster, input, { changes: true });
export const cancelGatheringAction = async (input: unknown) => run(cancelGathering, input, { changes: true });
export const updateGatheringAction = async (input: unknown) => run(updateGatheringDetails, input, { changes: true });
export const createOneOffGatheringAction = async (input: unknown) => run(createOneOffGathering, input, { changes: true });
export const suggestServingSubstitutesAction = async (input: unknown) => run(suggestServingSubstitutes, input, { changes: false });
export const shareServingLinkAction = async (input: unknown) => run(shareServingLink, input, { changes: false });

// Setup
export const createGatheringTypeAction = async (input: unknown) => run(createGatheringType, input, { changes: true });
export const updateGatheringTypeAction = async (input: unknown) => run(updateGatheringType, input, { changes: true });
export const setRosterTemplateAction = async (input: unknown) => run(setRosterTemplate, input, { changes: true });
export const createScheduleAction = async (input: unknown) => run(createGatheringSchedule, input, { changes: true });
export const endScheduleAction = async (input: unknown) => run(endGatheringSchedule, input, { changes: true });
export const appointWorshipCoordinatorAction = async (input: unknown) => run(appointWorshipCoordinator, input, { changes: true });
export const removeWorshipCoordinatorAction = async (input: unknown) => run(removeWorshipCoordinator, input, { changes: true });
export const createServingRoleAction = async (input: unknown) => run(createServingRole, input, { changes: true });
export const updateServingRoleAction = async (input: unknown) => run(updateServingRole, input, { changes: true });

// Teams and away dates
export const createWorshipTeamAction = async (input: unknown) => run(createWorshipTeam, input, { changes: true });
export const addWorshipTeamMemberAction = async (input: unknown) => run(addWorshipTeamMember, input, { changes: true });
export const removeWorshipTeamMemberAction = async (input: unknown) => run(removeWorshipTeamMember, input, { changes: true });
export const setMemberServingRolesAction = async (input: unknown) => run(setMemberServingRoles, input, { changes: true });
export const addUnavailabilityAction = async (input: unknown) => run(addUnavailability, input, { changes: true });
export const removeUnavailabilityAction = async (input: unknown) => run(removeUnavailability, input, { changes: true });
