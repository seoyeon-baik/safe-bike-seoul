export const maxDuration = 120;

import { endpoint } from '@/lib/server/http';
import { getAccidents } from '@/lib/server/taas-accidents';

export async function GET(request: Request) {
  return endpoint(() => getAccidents(request));
}
