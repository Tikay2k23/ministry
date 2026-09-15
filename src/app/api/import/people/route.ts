import { NextResponse } from 'next/server';
import { validationError } from '@/server/errors';
import { MAX_IMPORT_BYTES, previewPeopleImport } from '@/server/modules/import/people-import.service';
import { getDb } from '@/server/next/db';
import { isSameOrigin, portalJsonRoute } from '@/server/next/route';

/**
 * Upload a CSV and create an import preview (nothing is imported yet).
 * A route handler rather than a server action: server actions cap request bodies at 1 MB.
 */
const handler = portalJsonRoute(async ({ ctx }, request) => {
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) throw validationError({ file: ['Choose a CSV file to upload.'] });
  if (file.size > MAX_IMPORT_BYTES) throw validationError({ file: ['The file is larger than 5 MB.'] });
  if (!/\.csv$/i.test(file.name)) {
    throw validationError({ file: ['Please upload a .csv file. In Excel: File → Save As → “CSV UTF-8”.'] });
  }

  // Excel on Windows often saves CSV as Windows-1252; decode that so names like “Peña” survive.
  const bytes = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(bytes);

  return previewPeopleImport(getDb(), ctx, { fileName: file.name, text });
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Cross-site request refused.' } }, { status: 403 });
  }
  return handler(request);
}
