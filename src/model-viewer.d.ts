// Type declarations for @google/model-viewer web component
import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          poster?: string;
          "camera-controls"?: boolean;
          "auto-rotate"?: boolean;
          "shadow-intensity"?: string;
          "environment-image"?: string;
          exposure?: string;
          ar?: boolean;
          "ar-modes"?: string;
          loading?: "auto" | "lazy" | "eager";
          reveal?: "auto" | "manual";
        },
        HTMLElement
      >;
    }
  }
}
