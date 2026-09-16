'use server';

import { revalidatePath } from 'next/cache';
import {
  assignToSlot,
  cancelAssignment,
  getAssignmentReport,
  resolveFollowUp,
  shareAssignmentLink,
  substituteAssignment,
  suggestSubstitutes,
} from '@/server/modules/prayer/assignments.service';
import { createChain, setChainStatus, updateChain } from '@/server/modules/prayer/chains.service';
import { createCommitment, endCommitment } from '@/server/modules/prayer/commitments.service';
import { appointCoordinator, removeCoordinator } from '@/server/modules/prayer/coordinators.service';
import { addSchedule, endSchedule } from '@/server/modules/prayer/schedules.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

/**
 * Server actions for the prayer chain pages (docs/04 A16–A18). The services check permission and
 * chain scope for every call; these only connect the page to them.
 */

type Service<T> = (db: ReturnType<typeof getDb>, ctx: Awaited<ReturnType<typeof requirePortal>>['ctx'], input: unknown) => Promise<T>;

async function run<T>(service: Service<T>, input: unknown, options: { changes: boolean }) {
  const { ctx } = await requirePortal();
  const result = await runAction(() => service(getDb(), ctx, input));
  if (result.ok && options.changes) revalidatePath('/app/prayer', 'layout');
  return result;
}

// Chains, schedules and commitments
export const createChainAction = async (input: unknown) => run(createChain, input, { changes: true });
export const updateChainAction = async (input: unknown) => run(updateChain, input, { changes: true });
export const setChainStatusAction = async (input: unknown) => run(setChainStatus, input, { changes: true });
export const addScheduleAction = async (input: unknown) => run(addSchedule, input, { changes: true });
export const endScheduleAction = async (input: unknown) => run(endSchedule, input, { changes: true });
export const createCommitmentAction = async (input: unknown) => run(createCommitment, input, { changes: true });
export const endCommitmentAction = async (input: unknown) => run(endCommitment, input, { changes: true });
export const appointCoordinatorAction = async (input: unknown) => run(appointCoordinator, input, { changes: true });
export const removeCoordinatorAction = async (input: unknown) => run(removeCoordinator, input, { changes: true });

// The board
export const assignAction = async (input: unknown) => run(assignToSlot, input, { changes: true });
export const substituteAction = async (input: unknown) => run(substituteAssignment, input, { changes: true });
export const cancelAssignmentAction = async (input: unknown) => run(cancelAssignment, input, { changes: true });
export const resolveFollowUpAction = async (input: unknown) => run(resolveFollowUp, input, { changes: true });
export const suggestSubstitutesAction = async (input: unknown) => run(suggestSubstitutes, input, { changes: false });
export const shareLinkAction = async (input: unknown) => run(shareAssignmentLink, input, { changes: false });
export const viewReportAction = async (input: unknown) => run(getAssignmentReport, input, { changes: false });
