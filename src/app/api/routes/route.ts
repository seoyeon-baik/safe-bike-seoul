export const maxDuration = 120;

import { endpoint } from '@/lib/server/http';
import { getRoutes } from '@/lib/server/kakao-routes';

export async function GET(request: Request) {
  return endpoint(() => getRoutes(request));
}
