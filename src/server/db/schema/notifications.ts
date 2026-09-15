import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, smallint, text, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, oneOf, pk, tstz } from '../columns';
import { DELIVERY_STATUSES, NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES } from '../enums';
import { users } from './iam';
import { people } from './people';

/**
 * Notification intents and their delivery attempts (docs/02 §6, docs/03 §4.13). Templates live
 * in code for the MVP; the editable template, preference and push-subscription tables arrive
 * with the channels that need them.
 */

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    category: text('category').notNull(),
    templateKey: text('template_key').notNull(),
    recipientPersonId: uuid('recipient_person_id').references((): AnyPgColumn => people.id),
    /** Portal users also see the notification in their in-app inbox. */
    recipientUserId: uuid('recipient_user_id').references((): AnyPgColumn => users.id),
    /** NEVER sensitive content and never secrets: links with tokens are created at send time. */
    payload: jsonb('payload').notNull().default({}),
    dedupeKey: text('dedupe_key').notNull().unique(),
    scheduledFor: tstz('scheduled_for').notNull().defaultNow(),
    status: text('status', { enum: NOTIFICATION_STATUSES }).notNull().default('pending'),
    suppressedReason: text('suppressed_reason'),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    sentAt: tstz('sent_at'),
    readAt: tstz('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('notifications_status_check', oneOf('status', NOTIFICATION_STATUSES)),
    check('notifications_recipient', sql`recipient_person_id IS NOT NULL OR recipient_user_id IS NOT NULL`),
    index('notifications_inbox').on(t.recipientUserId, t.createdAt.desc()).where(sql`recipient_user_id IS NOT NULL`),
    index('notifications_due').on(t.scheduledFor).where(sql`status = 'pending'`),
  ],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: pk(),
    notificationId: uuid('notification_id')
      .notNull()
      .references((): AnyPgColumn => notifications.id, { onDelete: 'cascade' }),
    channel: text('channel', { enum: NOTIFICATION_CHANNELS }).notNull(),
    provider: text('provider').notNull(),
    /** e.g. "m•••@gmail.com" — never the full address. */
    destinationMasked: text('destination_masked').notNull(),
    status: text('status', { enum: DELIVERY_STATUSES }).notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    sentAt: tstz('sent_at'),
    deliveredAt: tstz('delivered_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('deliveries_channel_check', oneOf('channel', NOTIFICATION_CHANNELS)),
    check('deliveries_status_check', oneOf('status', DELIVERY_STATUSES)),
    index('deliveries_by_notification').on(t.notificationId),
  ],
);
