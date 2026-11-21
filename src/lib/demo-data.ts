export type Place = { id: string; name: string; area: string; lat: number; lng: number };
export const places: Place[] = [
  { id: 'yeouido', name: '여의나루역', area: '영등포구 여의동로 · 2번 출구', lat: 37.5271, lng: 126.9328 },
  { id: 'banpo', name: '반포한강공원', area: '서초구 신반포로11길 40', lat: 37.5103, lng: 126.9959 },
  { id: 'mangwon', name: '망원한강공원', area: '마포구 마포나루길 467', lat: 37.5557, lng: 126.8951 },
  { id: 'seonyu', name: '선유도공원', area: '영등포구 선유로 343', lat: 37.5434, lng: 126.9000 },
  { id: 'ttukseom', name: '뚝섬한강공원', area: '광진구 강변북로 139', lat: 37.5294, lng: 127.0699 },
];
