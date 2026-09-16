'use client';

import { useRouter } from 'next/navigation';
import { FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { useActionForm } from '@/components/forms/use-action-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { chainShape, checkChainDates, checkScheduleValues, scheduleShape } from '@/server/modules/prayer/prayer.schemas';
import { createChainAction } from '../actions';
import { ChainBasicsFields, ChainChoicesFields, checkWeekdays, repeatShape, ruleFor, SlotPatternFields } from '../chain-fields';
import { SectionCard } from '../section-card';

/** The form's own shape (a plain-language repeat choice), turned into the service's input on submit. */
const ChainForm = z
  .object({
    ...chainShape,
    ...repeatShape,
    firstSlotTime: scheduleShape.firstSlotTime,
    slotMinutes: scheduleShape.slotMinutes,
    slotsPerOccurrence: scheduleShape.slotsPerOccurrence,
    capacity: scheduleShape.capacity,
    generateDaysAhead: scheduleShape.generateDaysAhead,
  })
  .superRefine((value, ctx) => {
    checkChainDates(value, ctx);
    checkScheduleValues({ ...value, effectiveFrom: value.startsOn, effectiveTo: value.endsOn }, ctx);
    checkWeekdays(value, ctx);
  })
  .transform(({ repeat, weekdays, firstSlotTime, slotMinutes, slotsPerOccurrence, capacity, generateDaysAhead, ...chain }) => ({
    ...chain,
    schedule: {
      rrule: ruleFor(repeat, weekdays),
      firstSlotTime,
      slotMinutes,
      slotsPerOccurrence,
      capacity,
      generateDaysAhead,
      effectiveFrom: chain.startsOn,
      effectiveTo: chain.endsOn ?? null,
    },
  }));

export function CreateChainForm({
  ministries,
  requiresMinistry,
  defaultTimezone,
  today,
}: {
  ministries: { id: string; name: string }[];
  requiresMinistry: boolean;
  defaultTimezone: string;
  today: string;
}) {
  const router = useRouter();
  const { form, submit, pending, formError } = useActionForm({
    schema: ChainForm,
    defaultValues: {
      name: '',
      description: '',
      chainType: 'continuous',
      timezone: defaultTimezone,
      ministryId: requiresMinistry ? (ministries[0]?.id ?? '') : '',
      startsOn: today,
      endsOn: '',
      graceMinutes: 15,
      checkinOpensMinutes: 15,
      requireCheckin: false,
      showNamesPublicly: false,
      collectReports: true,
      repeat: 'daily',
      weekdays: [],
      firstSlotTime: '00:00',
      slotMinutes: 60,
      slotsPerOccurrence: 24,
      capacity: 1,
      generateDaysAhead: 14,
    },
    action: createChainAction,
    onSuccess: (data) => router.push(`/app/prayer/${data.chainId}/setup`),
  });

  return (
    <FormProvider {...form}>
      <form onSubmit={submit} noValidate className="space-y-6">
        <SectionCard title="Basics">
          <ChainBasicsFields ministries={ministries} allowNoMinistry={!requiresMinistry} />
        </SectionCard>
        <SectionCard title="Prayer slots" description="How the chain repeats and how long each slot is.">
          <SlotPatternFields startName="startsOn" endName="endsOn" />
        </SectionCard>
        <SectionCard title="Choices">
          <ChainChoicesFields />
        </SectionCard>
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? 'Creating…' : 'Create chain'}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
