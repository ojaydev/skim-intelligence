import { Composition } from "remotion";
import { SkimDemo } from "./SkimDemo";
import { VIDEO } from "./Brand";

export const RemotionRoot = () => {
  return (
    <Composition
      id="SkimDemo"
      component={SkimDemo}
      durationInFrames={VIDEO.durationFrames}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
  );
};
