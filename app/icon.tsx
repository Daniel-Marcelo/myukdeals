import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
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
            width: 18,
            height: 12,
            background: "#312e81",
            borderRadius: 2,
            transform: "rotate(10deg) translateY(1px)",
          }}
        />
        {/* Mid card */}
        <div
          style={{
            position: "absolute",
            width: 18,
            height: 12,
            background: "#3730a3",
            borderRadius: 2,
            transform: "rotate(-5deg)",
          }}
        />
        {/* Front card */}
        <div
          style={{
            position: "absolute",
            width: 18,
            height: 12,
            background: "#4f46e5",
            borderRadius: 2,
          }}
        />
      </div>
    ),
    { ...size }
  );
}
