'use client';

import { Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { useActionForm } from '@/components/forms/use-action-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, inputClassName } from '@/components/ui/field';
import { SERVING_ROLE_CATEGORIES, type ServingRoleCategory } from '@/server/db/enums';
import { SERVING_CATEGORY_LABELS, timeOfDay } from '@/server/modules/devotional/devotional.schemas';
import { createGatheringTypeAction, createServingRoleAction, updateServingRoleAction } from '../actions';

/** Setup actions (docs/04 A21): new kinds of gatherings and the serving-role vocabulary. */

// ─── New kind of gathering ────────────────────────────────────────────────────

const TypeForm = z.object({
  name: z.string().trim().min(1, 'Name the gathering').max(80),
  defaultStartTime: timeOfDay,
  defaultDurationMinutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(600, 'At most 10 hours'),
  ministryId: z.string(),
  responseLockHours: z.coerce.number().int().min(0).max(168),
});

function NewTypeBody({ ministries, requiresMinistry }: { ministries: { id: string; name: string }[]; requiresMinistry: boolean }) {
  const router = useRouter();
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: TypeForm,
    defaultValues: { name: '', defaultStartTime: '06:00', defaultDurationMinutes: 60, ministryId: requiresMinistry ? (ministries[0]?.id ?? '') : '', responseLockHours: 12 },
    action: (values) => createGatheringTypeAction({ ...values, ministryId: values.ministryId || null }),
    onSuccess: (data) => router.push(`/app/devotional/setup/${data.gatheringTypeId}`),
  });
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Name" placeholder="Sunday Service" {...form.register('name')} errors={errorsFor('name')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Usual start time" type="time" {...form.register('defaultStartTime')} errors={errorsFor('defaultStartTime')} />
        <Field label="Minutes" type="number" min={5} max={600} {...form.register('defaultDurationMinutes')} errors={errorsFor('defaultDurationMinutes')} />
      </div>
      {ministries.length > 0 && (
        <div className="space-y-1.5">
          <label htmlFor="type-ministry" className="block text-sm font-medium">
            Ministry
          </label>
          <select id="type-ministry" {...form.register('ministryId')} className={inputClassName}>
            {!requiresMinistry && <option value="">No particular ministry</option>}
            {ministries.map((ministry) => (
              <option key={ministry.id} value={ministry.id}>
                {ministry.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <Field
        label="Replies can be changed until (hours before)"
        type="number"
        min={0}
        max={168}
        hint="After this, people who replied are asked to contact their coordinator."
        {...form.register('responseLockHours')}
        errors={errorsFor('responseLockHours')}
      />
      {formError && <Alert tone="error">{formError}</Alert>}
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add gathering'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function NewGatheringTypeButton({ ministries, requiresMinistry }: { ministries: { id: string; name: string }[]; requiresMinistry: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus aria-hidden className="size-4" /> New gathering
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New kind of gathering</DialogTitle>
          <DialogDescription>Then add its roster template and a schedule.</DialogDescription>
        </DialogHeader>
        {open && <NewTypeBody ministries={ministries} requiresMinistry={requiresMinistry} />}
      </DialogContent>
    </Dialog>
  );
}

// ─── Serving roles ────────────────────────────────────────────────────────────

const RoleForm = z.object({
  name: z.string().trim().min(1, 'Name the role').max(60),
  category: z.enum(SERVING_ROLE_CATEGORIES),
  isActive: z.boolean(),
});

function RoleBody({ role, onDone }: { role: { id: string; name: string; category: ServingRoleCategory; isActive: boolean } | null; onDone: () => void }) {
  const router = useRouter();
  const { form, submit, pending, formError, errorsFor } = useActionForm({
    schema: RoleForm,
    defaultValues: { name: role?.name ?? '', category: role?.category ?? 'music', isActive: role?.isActive ?? true },
    action: (values) => (role ? updateServingRoleAction({ servingRoleId: role.id, ...values }) : createServingRoleAction({ name: values.name, category: values.category })),
    onSuccess: () => {
      onDone();
      router.refresh();
    },
  });
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Name" placeholder="Violin" {...form.register('name')} errors={errorsFor('name')} />
      <div className="space-y-1.5">
        <label htmlFor="role-category" className="block text-sm font-medium">
          Kind of role
        </label>
        <select id="role-category" {...form.register('category')} className={inputClassName}>
          {SERVING_ROLE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {SERVING_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </div>
      {role && (
        <Controller
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <label className="flex items-start gap-3">
              <Checkbox checked={field.value === true} onCheckedChange={(checked) => field.onChange(checked === true)} className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">In use</span>
                <span className="block text-sm text-muted">Switched-off roles can’t be added to rosters, but past rosters keep them.</span>
              </span>
            </label>
          )}
        />
      )}
      {formError && <Alert tone="error">{formError}</Alert>}
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : role ? 'Save role' : 'Add role'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ServingRoleButton({ role }: { role?: { id: string; name: string; category: ServingRoleCategory; isActive: boolean } }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {role ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${role.name}`}>
            <Pencil aria-hidden className="size-4" />
          </Button>
        ) : (
          <Button variant="secondary" size="sm">
            <Plus aria-hidden className="size-4" /> New role
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : 'New serving role'}</DialogTitle>
          <DialogDescription>Serving roles are shared by every kind of gathering.</DialogDescription>
        </DialogHeader>
        {open && <RoleBody role={role ?? null} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
