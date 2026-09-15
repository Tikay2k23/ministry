import { describe, expect, it } from 'vitest';
import { evaluateContentAccess } from '@/server/modules/journal/content-access';
import { branchGrant, globalGrant, userContext } from '../helpers/fixtures';

// Pastor ─ Michael ─ Mark ─ John
const subject = { personId: 'john', hierarchyPath: ['pastor', 'michael', 'mark'] };
const today = new Map([
  ['mark', 1],
  ['michael', 2],
  ['pastor', 3],
]);

const leaderGrants = (anchor: string) => [
  branchGrant('journal.content.view', anchor),
  branchGrant('journal.content.restricted.view', anchor, 1),
];

describe('journal content access', () => {
  it('lets the direct leader read standard and restricted answers, never confidential', () => {
    const mark = userContext({ id: 'u-mark', personId: 'mark' }, leaderGrants('mark'));
    expect(evaluateContentAccess(mark, subject, 1, today)).toEqual({ standard: true, restricted: true, confidential: false });
  });

  it('keeps higher leaders to status only unless the ministry widens visibility', () => {
    const michael = userContext({ id: 'u-michael', personId: 'michael' }, leaderGrants('michael'));
    expect(evaluateContentAccess(michael, subject, 1, today)).toEqual({ standard: false, restricted: false, confidential: false });
    expect(evaluateContentAccess(michael, subject, 2, today)).toEqual({ standard: true, restricted: false, confidential: false });
  });

  it('gives pastoral global grants every tier regardless of position', () => {
    const pastor = userContext({ id: 'u-pastor' }, [
      globalGrant('journal.content.view'),
      globalGrant('journal.content.restricted.view'),
      globalGrant('journal.content.confidential.view'),
    ]);
    expect(evaluateContentAccess(pastor, subject, 0, new Map())).toEqual({ standard: true, restricted: true, confidential: true });
  });

  it('stops a former leader reading after a move, and a new leader reading entries from before', () => {
    const mark = userContext({ id: 'u-mark', personId: 'mark' }, leaderGrants('mark'));
    const afterMove = new Map([
      ['anna', 1],
      ['samuel', 2],
      ['pastor', 3],
    ]);
    expect(evaluateContentAccess(mark, subject, 1, afterMove).standard).toBe(false);

    const anna = userContext({ id: 'u-anna', personId: 'anna' }, leaderGrants('anna'));
    expect(evaluateContentAccess(anna, subject, 1, afterMove).standard).toBe(false);
    expect(evaluateContentAccess(anna, { personId: 'john', hierarchyPath: ['pastor', 'samuel', 'anna'] }, 1, afterMove).standard).toBe(true);
  });

  it('shows people their own journal and nothing to other actors or when visibility is off', () => {
    const john = userContext({ id: 'u-john', personId: 'john' }, []);
    expect(evaluateContentAccess(john, subject, 1, today)).toEqual({ standard: true, restricted: true, confidential: true });

    const mark = userContext({ id: 'u-mark', personId: 'mark' }, leaderGrants('mark'));
    expect(evaluateContentAccess(mark, subject, 0, today).standard).toBe(false);
    expect(evaluateContentAccess({ ...mark, actor: { kind: 'participant', personId: 'mark' } }, subject, 1, today).standard).toBe(false);
  });
});
