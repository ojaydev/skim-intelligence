// Centralised brand tokens — mirror apps/web/src/index.css so the video
// shares the dashboard's visual language exactly.

import { loadFont as loadCormorant } from "@remotion/google-fonts/CormorantGaramond";
import { loadFont as loadDmSans } from "@remotion/google-fonts/DMSans";
import { loadFont as loadDmMono } from "@remotion/google-fonts/DMMono";

const cormorant = loadCormorant("normal", {
  weights: ["300", "400", "600"],
  subsets: ["latin"],
});
const dmSans = loadDmSans("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
});
const dmMono = loadDmMono("normal", {
  weights: ["400"],
  subsets: ["latin"],
});

export const fonts = {
  display: cormorant.fontFamily,
  body: dmSans.fontFamily,
  mono: dmMono.fontFamily,
};

export const colors = {
  bg: "#080808",
  bg2: "#0e0e0e",
  bg3: "#141414",
  border: "rgba(247, 244, 239, 0.08)",
  borderMid: "rgba(247, 244, 239, 0.14)",
  text: "#f7f4ef",
  textDim: "rgba(247, 244, 239, 0.5)",
  textFaint: "rgba(247, 244, 239, 0.22)",
  cyan: "#35e7ff",
  cyanDim: "rgba(53, 231, 255, 0.10)",
  cyanMid: "rgba(53, 231, 255, 0.28)",
  green: "#3dffa0",
  red: "#ff4e4e",
  amber: "#ffb347",
};

// Composition base — referenced by every scene. ~179s total to match
// the recorded voiceover (177.6s) + a 1.4s breathing tail on the outro.
export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
  durationFrames: 5370, // 179s @ 30fps
};
