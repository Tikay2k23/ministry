/** Plain words for the audit actions recorded about a person (the profile's Activity list). */

const ACTION_LABELS: Record<string, string> = {
  'person.created': 'Added to the directory',
  'person.updated': 'Profile updated',
  'person.archived': 'Archived',
  'registration.confirmed': 'Registration confirmed',
  'registration.declined': 'Registration declined',
  'hierarchy.placed': 'Placed under a leader',
  'hierarchy.moved': 'Moved to another leader',
  'hierarchy.removed': 'Taken out of the leadership structure',
  'hierarchy.accepts_members_changed': 'Changed whether they receive new people',
  'hierarchy.change_requested': 'Leader change requested',
  'hierarchy.change_request_approved': 'Leader change approved',
  'hierarchy.change_request_declined': 'Leader change declined',
  'hierarchy.change_request_cancelled': 'Leader change request withdrawn',
  'journal.pause_added': 'Journal pause added',
  'journal.pause_ended': 'Journal pause ended',
  'journal.pause_cancelled': 'Journal pause cancelled',
  'journal.day_excused': 'A journal day excused',
  'journal.day_unexcused': 'A journal day no longer excused',
  'ministry.member_added': 'Joined a ministry',
  'ministry.member_ended': 'Left a ministry',
  'team.member_added': 'Joined a team',
  'team.member_ended': 'Left a team',
  'devotional.member_roles_set': 'Serving roles changed',
  'devotional.unavailability_added': 'Away dates added',
  'devotional.unavailability_removed': 'Away dates removed',
  'entry_code.rotated': 'Journal QR code replaced',
  'participant.registered': 'Registered from the journal page',
  'participant.identified': 'Recognised on a new phone',
  'participant.personal_link_issued': 'Personal link created',
  'participant.personal_link_used': 'Personal link used',
  'participant.keys_revoked': 'Remembered phones signed out',
};

export function activityLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/^[a-z_]+\./, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** "contactPhone" → "contact phone", for the list of changed fields. */
export function fieldLabel(field: string): string {
  return field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
}

export function activityActor(entry: { actorName: string | null; actorType: string }): string | null {
  if (entry.actorName) return entry.actorName;
  if (entry.actorType === 'participant') return 'the person themselves';
  if (entry.actorType === 'system') return 'the system';
  return null;
}
