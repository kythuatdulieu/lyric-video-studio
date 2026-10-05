import React from "react";
import { Composition } from "remotion";
import { LyricVideo, type LyricVideoProps } from "./LyricVideo";

const defaultProps: LyricVideoProps = {
  lines: [],
  mode: "line",
  visualizer: "none",
  accentColor: "#c8f169",
  fontFamily: "Arial, sans-serif",
  showProgress: true,
  durationInSeconds: 10,
};

export function RemotionRoot() {
  return <Composition
    id="LydraLyricVideo"
    component={LyricVideo}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={300}
    defaultProps={defaultProps}
  />;
}
