import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          background: "#0a0a0f",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Back card */}
        <div
          style={{
            position: "absolute",
            width: 100,
            height: 68,
            background: "#312e81",
            borderRadius: 10,
            transform: "rotate(10deg) translateY(4px)",
          }}
        />
        {/* Mid card */}
        <div
          style={{
            position: "absolute",
            width: 100,
            height: 68,
            background: "#3730a3",
            borderRadius: 10,
            transform: "rotate(-5deg)",
          }}
        />
        {/* Front card */}
        <div
          style={{
            position: "absolute",
            width: 104,
            height: 70,
            background: "#4f46e5",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            paddingLeft: 16,
            gap: 0,
          }}
        >
          {/* Content lines */}
          <div
            style={{
              width: 48,
              height: 6,
              background: "rgba(255,255,255,0.35)",
              borderRadius: 3,
              marginBottom: 8,
            }}
          />
          <div
            style={{
              width: 32,
              height: 5,
              background: "rgba(255,255,255,0.18)",
              borderRadius: 2,
            }}
          />
          {/* Orange price badge */}
          <div
            style={{
              position: "absolute",
              right: 10,
              bottom: 10,
              width: 24,
              height: 16,
              background: "#f97316",
              borderRadius: 4,
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  );
}
