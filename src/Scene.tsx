import { GenerativeTree } from "./shaders/elements/GenerativeTree";
import "./shaders/threeui.css";
import "./shaders/host-boundary.css";

/* Host boundary only. The three authored files are byte-identical to
   SHA-256 7a6871fe99fa; this is the mount point around them. Props are the
   specified values, verbatim — not rounded, not tuned. This file lives in
   src/ so the import specifiers above are the authored ones. */
export function Scene() {
  return (
    <div className="shader-frame">
      <GenerativeTree
        speed={2.41}
        size={1.12}
        particleAmount={2.00}
        hue={108}
        saturation={2.00}
        brightness={1.39}
        opacity={0.79}
      />
    </div>
  );
}
