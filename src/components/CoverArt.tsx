import { Sprite } from "./Sprite";

/** Cover slot (30x30 logical px): the theme's placeholder art until a real cover exists. */
export function CoverArt({ src = null }: { src?: string | null }) {
  if (src) return <img className="cover__img" src={src} alt="" draggable={false} />;
  return <Sprite name="cover-ph-30" w={30} h={30} />;
}