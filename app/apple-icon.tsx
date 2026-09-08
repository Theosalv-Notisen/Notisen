import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Samme kalendergeometri som ordmerket (components/brand/logo.tsx), skalert
// inn med luft rundt seg. Papirfarget strøk mot den mørke flisen.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <g transform="translate(9 10) scale(0.72)" fill="none" stroke="#F4F0E7" stroke-width="5">
    <rect x="10" y="14" width="44" height="40" rx="6" />
    <path d="M22 8 V18" stroke-linecap="round" />
    <path d="M42 8 V18" stroke-linecap="round" />
    <path d="M10 24 H54" />
    <circle cx="40" cy="40" r="5.5" fill="#12706A" stroke="none" />
  </g>
</svg>`;

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#201F1B",
          borderRadius: 40,
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img
          width="110"
          height="110"
          alt="Notisen"
          src={"data:image/svg+xml;utf8," + encodeURIComponent(svg)}
        />
      </div>
    ),
    size,
  );
}
