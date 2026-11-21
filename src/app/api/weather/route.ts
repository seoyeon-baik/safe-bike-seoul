export const maxDuration = 120;

import { endpoint } from '@/lib/server/http';
import { getWeather } from '@/lib/server/kma-weather';

export async function GET(request: Request) {
  return endpoint(() => getWeather(request));
}
