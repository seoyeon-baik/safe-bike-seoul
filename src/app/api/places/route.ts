export const maxDuration = 120;

import { endpoint } from '@/lib/server/http';
import { getPlaces } from '@/lib/server/providers';

export async function GET(request: Request) {
  return endpoint(() => getPlaces(request));
}
