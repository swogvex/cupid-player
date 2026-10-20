import { SPRITES } from "./themes.generated";

/** w x h: one cell (logical px). f: number of cells. r: frames per second. */
export type SpriteInfo = { w: number; h: number; f: number; r: number };

export function spriteInfo(theme: string, name: string): SpriteInfo | undefined {
  return SPRITES[theme]?.[name];
}

export function hasSprite(theme: string, name: string): boolean {
  return spriteInfo(theme, name) !== undefined;
}