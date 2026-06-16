/**
 * 광장 선택 캐릭터 카탈로그.
 *
 * 아트: "Adventure Hollow" chibi pack (Chie Waters) — 상업적 사용 허용(원본 재배포 금지).
 * 단일 치비 일러스트(여백 트림, 하단=발). 걷기 프레임은 없고 render.ts 가 절차적
 * 모션(idle/walk/jump)을 입힌다. key 는 백엔드 _CHARACTERS 와 일치해야 한다.
 */
export interface CharacterDef {
  key: string;
  label: string;
  src: string;
}

export const CHARACTERS: CharacterDef[] = [
  { key: "stalker", label: "레인저", src: "/plaza/char_stalker.png" },
  { key: "ninja", label: "닌자", src: "/plaza/char_ninja.png" },
  { key: "monk", label: "몽크", src: "/plaza/char_monk.png" },
  { key: "paladin", label: "팔라딘", src: "/plaza/char_paladin.png" },
  { key: "warrior", label: "워리어", src: "/plaza/char_warrior.png" },
  { key: "shaman", label: "샤먼", src: "/plaza/char_shaman.png" },
];

export const CHARACTER_KEYS = CHARACTERS.map((c) => c.key);
export const DEFAULT_CHARACTER = "stalker";

export function characterSrc(key: string | null | undefined): string {
  const c = CHARACTERS.find((x) => x.key === key);
  return (c ?? CHARACTERS[0]).src;
}
