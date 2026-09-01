import type { WorldSource } from "@jackharrhy/worldview";
import type { WorldViewElement } from "@jackharrhy/worldview/element";
import { clientEntry, css, ref, type Handle, type SerializableProps } from "remix/ui";

import { routes } from "../../routes.ts";

const rootStyle = css({ position: "relative", width: "100%" });
const mountStyle = css({ width: "100%" });
const helpStyle = css({
  background: "rgba(7, 16, 12, 0.72)",
  bottom: "0.625rem",
  color: "#d9f4df",
  fontSize: "0.6875rem",
  padding: "0.35rem 0.5rem",
  pointerEvents: "none",
  position: "absolute",
  right: "0.625rem",
});

interface BspViewerProps extends SerializableProps {
  bspUrl: string;
  fileId: string;
  paletteUrl?: string;
  wadUrls: string[];
  hasDependencyManifest: boolean;
  walkabilityUrl?: string;
  height?: number;
}

export const BspViewer = clientEntry(
  `${import.meta.url}#BspViewer`,
  function BspViewer(handle: Handle<BspViewerProps>) {
    return () => {
      const height = handle.props.height ?? 480;
      return (
        <div mix={rootStyle}>
          <div
            aria-label="Interactive BSP map"
            mix={[
              mountStyle,
              ref((element, signal) => {
                void mountWorldView(element, handle.props, height, signal).catch(
                  (cause: unknown) => {
                    if (signal.aborted) return;
                    console.error("Worldview: failed to initialize", cause);
                    element.textContent = "The interactive map could not be loaded.";
                    element.setAttribute("role", "alert");
                  },
                );
              }),
            ]}
          />
          <div mix={helpStyle}>
            Click to capture · WASD to move · V toggles noclip · G toggles navigation
          </div>
        </div>
      );
    };
  },
);

async function mountWorldView(
  mount: Element,
  props: BspViewerProps,
  height: number,
  signal: AbortSignal,
): Promise<void> {
  const { defineWorldViewElement } = await import("@jackharrhy/worldview/element");
  if (signal.aborted) return;

  defineWorldViewElement();
  const worldView = document.createElement("world-view") as WorldViewElement;
  worldView.style.height = `${height}px`;
  worldView.style.width = "100%";
  worldView.setAttribute("controls", "walk");
  worldView.setAttribute("audio", "false");
  worldView.source = worldSource(props);
  worldView.walkabilitySource = props.walkabilityUrl ?? null;
  worldView.addEventListener("warning", (event) => {
    console.warn("Worldview:", event.detail.message);
  });
  worldView.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.code !== "KeyG" || keyboardEvent.repeat) return;
    worldView.walkabilityVisible = !worldView.walkabilityVisible;
  });
  mount.append(worldView);
  signal.addEventListener("abort", () => worldView.remove(), { once: true });
}

function worldSource(props: BspViewerProps): WorldSource {
  return {
    bsp: props.bspUrl,
    ...(props.paletteUrl ? { palette: props.paletteUrl } : {}),
    ...(props.wadUrls.length ? { wads: props.wadUrls } : {}),
    ...(props.hasDependencyManifest
      ? {}
      : {
          resolveWad: (reference) =>
            routes.api.bspWad.href({
              fileId: props.fileId,
              wadName: reference.basename,
            }),
        }),
  };
}
