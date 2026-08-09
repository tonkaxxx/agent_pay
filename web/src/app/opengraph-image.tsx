import { ImageResponse } from "next/og";

export const alt = "AgentPay — payment infrastructure for autonomous software";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "stretch",
        background: "#f2eee4",
        color: "#171815",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "space-between",
        padding: "64px 72px",
        position: "relative",
        width: "100%",
      }}
    >
      <div style={{ alignItems: "center", display: "flex", fontFamily: "serif", fontSize: 34 }}>
        <div style={{ alignItems: "center", background: "#171815", borderRadius: 999, color: "#f2eee4", display: "flex", fontFamily: "sans-serif", fontSize: 18, height: 42, justifyContent: "center", marginRight: 14, width: 42 }}>A</div>
        AgentPay
      </div>
      <div style={{ color: "rgba(226,75,49,.14)", display: "flex", fontFamily: "sans-serif", fontSize: 360, fontWeight: 800, letterSpacing: "-35px", lineHeight: .65, position: "absolute", right: 55, top: 145 }}>402</div>
      <div style={{ display: "flex", flexDirection: "column", position: "relative" }}>
        <div style={{ color: "#e24b31", display: "flex", fontFamily: "sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: 3, marginBottom: 25, textTransform: "uppercase" }}>HTTP-native · USDC · Base</div>
        <div style={{ display: "flex", flexDirection: "column", fontFamily: "serif", fontSize: 92, letterSpacing: -4, lineHeight: .9 }}>
          <span>APIs can now</span>
          <span style={{ color: "#e24b31", fontStyle: "italic" }}>charge themselves.</span>
        </div>
      </div>
      <div style={{ borderTop: "1px solid #d4cbbb", display: "flex", fontFamily: "sans-serif", fontSize: 17, justifyContent: "space-between", paddingTop: 24 }}>
        <span>The transaction layer for the agent economy.</span>
        <span style={{ color: "#696258" }}>Working MVP · Base Mainnet</span>
      </div>
    </div>,
    size,
  );
}
