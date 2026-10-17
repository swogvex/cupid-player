import { useState, type CSSProperties } from "react";
import { PixelButton } from "../components/PixelButton";
import { PixelInput } from "../components/PixelInput";
import { PixelPanel } from "../components/PixelPanel";
import { ProgressStar } from "../components/ProgressStar";
import { Sprite } from "../components/Sprite";

const SCALES = [2, 3, 4] as const;

const SPRITES: ReadonlyArray<readonly [string, number, number]> = [
  ["heart-8", 8, 8],
  ["heart-16", 16, 16],
  ["star-9", 9, 9],
  ["star-9-drag", 9, 9],
  ["bow-20x7", 20, 7],
  ["heart-wings-24x7", 24, 7],
];

export default function Gallery() {
  const [progress, setProgress] = useState(0.35);
  const [text, setText] = useState("");
  const [nav, setNav] = useState("library");

  return (
    <div style={{ height: "100vh", overflow: "auto", background: "var(--bg)", padding: 16 }}>
      {SCALES.map((n) => (
        <section
          key={n}
          style={{ "--s": n, marginBottom: 32, color: "var(--ink)" } as CSSProperties}
        >
          <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>x{n}</h2>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "calc(var(--s) * 6px)",
              marginBottom: "calc(var(--s) * 6px)",
            }}
          >
            {SPRITES.map(([name, w, h]) => (
              <Sprite key={name} name={name} w={w} h={h} />
            ))}
          </div>

          <PixelPanel style={{ maxWidth: "calc(var(--s) * 200px)" }}>
            <div style={{ display: "grid", gap: "calc(var(--s) * 4px)" }}>
              <div style={{ fontSize: "calc(var(--s) * 8px)" }}>cupid player ♥ ñandú áéíóú ¿?</div>

              <div style={{ display: "flex", gap: "calc(var(--s) * 4px)", flexWrap: "wrap" }}>
                <PixelButton>Importar</PixelButton>
                <PixelButton disabled>Desactivado</PixelButton>
                <PixelButton variant="icon" aria-label="Corazón">
                  <Sprite name="heart-8" w={8} h={8} />
                </PixelButton>
              </div>

              <div style={{ display: "grid", gap: "calc(var(--s) * 2px)", width: "calc(var(--s) * 72px)" }}>
                {["library", "playlists", "stats"].map((id) => (
                  <PixelButton
                    key={id}
                    variant="nav"
                    active={nav === id}
                    onClick={() => setNav(id)}
                  >
                    {id}
                  </PixelButton>
                ))}
              </div>

              <PixelInput
                placeholder="Paste Spotify link"
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label="Enlace de Spotify"
              />

              <ProgressStar value={progress} onChange={setProgress} label="Progreso" />
            </div>
          </PixelPanel>
        </section>
      ))}
    </div>
  );
}