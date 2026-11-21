export const maxDuration = 120;

import { endpoint } from '@/lib/server/http';
import { getStations } from '@/lib/server/seoul-stations';

export async function GET(request: Request) {
  return endpoint(() => getStations(request));
}
