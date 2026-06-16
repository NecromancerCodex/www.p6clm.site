/**
 * 광장 선택 캐릭터 카탈로그.
 *
 * 스프라이트시트: MV Platformer Male (MoikMellah, OpenGameArt, CC0/public domain)
 * 레이어 합성본. 모두 320×640, 32×64 프레임, 10열, 오른쪽 바라봄.
 * key 는 백엔드 _CHARACTERS 와 일치해야 한다.
 */
export interface CharacterDef {
  key: string;
  label: string;
  src: string;
}

export const CHARACTERS: CharacterDef[] = [
  { key: "adventurer", label: "모험가", src: "/plaza/char_adventurer.png" },
  { key: "ninja", label: "닌자", src: "/plaza/char_ninja.png" },
  { key: "knight", label: "기사", src: "/plaza/char_knight.png" },
  { key: "ninjared", label: "붉은 닌자", src: "/plaza/char_ninjared.png" },
];

export const CHARACTER_KEYS = CHARACTERS.map((c) => c.key);
export const DEFAULT_CHARACTER = "adventurer";

export function characterSrc(key: string | null | undefined): string {
  const c = CHARACTERS.find((x) => x.key === key);
  return (c ?? CHARACTERS[0]).src;
}
