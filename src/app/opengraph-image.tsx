import { ImageResponse } from "next/og";

export const alt = "PrefixRiver — see where your prompt cache breaks";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Cached share of each band (0..1) and where the break happens, as fractions of max width.
const BANDS: { len: number; cached: number; crack?: number }[] = [
  { len: 0.42, cached: 0 },
  { len: 0.5, cached: 0.42 },
  { len: 0.58, cached: 0.5 },
  { len: 0.66, cached: 0.2, crack: 0.2 },
  { len: 0.74, cached: 0.66 },
  { len: 0.82, cached: 0.74 },
  { len: 0.9, cached: 0.82 },
];

export default function OpengraphImage() {
  const riverW = 1040;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(160deg, #0d1a2a 0%, #05070d 55%)",
          padding: "56px 80px",
          color: "#e6ebf5",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 4,
              padding: "0 6px",
              background: "#0b1220",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <div style={{ width: 14, height: 4, borderRadius: 2, background: "#5eead4" }} />
            <div style={{ width: 20, height: 4, borderRadius: 2, background: "#38bdf8" }} />
            <div style={{ display: "flex", gap: 2 }}>
              <div style={{ width: 10, height: 4, borderRadius: 2, background: "#5eead4" }} />
              <div style={{ width: 8, height: 4, borderRadius: 2, background: "#fb923c" }} />
            </div>
          </div>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -1 }}>PrefixRiver</div>
          <div
            style={{
              marginLeft: "auto",
              fontSize: 18,
              color: "#99f6e4",
              border: "1px solid rgba(94,234,212,0.35)",
              borderRadius: 999,
              padding: "6px 16px",
            }}
          >
            100% local · no API keys
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 46 }}>
          {BANDS.map((b, i) => {
            const total = b.len * riverW;
            const cached = b.cached * riverW;
            const crackAt = b.crack !== undefined ? b.crack * riverW : undefined;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", height: 22 }}>
                {cached > 0 && (
                  <div
                    style={{
                      width: cached,
                      height: 22,
                      borderRadius: 11,
                      background: "linear-gradient(90deg, #5eead4, #38bdf8)",
                      boxShadow: "0 0 24px rgba(94,234,212,0.55)",
                    }}
                  />
                )}
                {crackAt !== undefined ? (
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div
                      style={{
                        width: 4,
                        height: 34,
                        marginLeft: 3,
                        marginRight: 3,
                        background: "#fff7ed",
                        transform: "skewX(-18deg)",
                        boxShadow: "0 0 18px #fb923c",
                      }}
                    />
                    <div
                      style={{
                        width: total - crackAt - 10,
                        height: 22,
                        borderRadius: 11,
                        background: "linear-gradient(90deg, #fb923c, #f43f5e)",
                        boxShadow: "0 0 30px rgba(244,63,94,0.6)",
                      }}
                    />
                  </div>
                ) : (
                  <div
                    style={{
                      width: total - cached - (cached > 0 ? 4 : 0),
                      marginLeft: cached > 0 ? 4 : 0,
                      height: 22,
                      borderRadius: 11,
                      background: "rgba(226,232,240,0.55)",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          <div style={{ fontSize: 50, fontWeight: 700, letterSpacing: -2, lineHeight: 1.08, maxWidth: 1000 }}>
            See exactly where your agent&apos;s prompt cache breaks — and what each break costs.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
