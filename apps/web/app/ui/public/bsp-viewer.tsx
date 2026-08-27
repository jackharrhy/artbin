import { createWorldview, type ProgressDetail, type WorldviewViewer } from "@jackharrhy/worldview";
import { clientEntry, css, ref, type Handle, type SerializableProps } from "remix/ui";

import { routes } from "../../routes.ts";
import { dangerTextStyle, theme } from "../styles.ts";

const rootStyle = css({ position: "relative", width: "100%" });
const canvasStyle = css({ background: "#07100c", display: "block", width: "100%" });
const overlayStyle = css({
  alignItems: "center",
  background: "rgba(7, 16, 12, 0.88)",
  color: "#d9f4df",
  display: "flex",
  inset: 0,
  justifyContent: "center",
  padding: "1.5rem",
  position: "absolute",
  textAlign: "center",
});
const messageStyle = css({ fontFamily: theme.font.mono, fontSize: "0.8125rem" });
const helpStyle = css({
  background: "rgba(7, 16, 12, 0.72)",
  bottom: "0.625rem",
  color: "#d9f4df",
  fontSize: "0.6875rem",
  padding: "0.35rem 0.5rem",
  position: "absolute",
  right: "0.625rem",
});

interface BspViewerProps extends SerializableProps {
  bspUrl: string;
  fileId: string;
  paletteUrl?: string;
  height?: number;
}

export const BspViewer = clientEntry(
  `${import.meta.url}#BspViewer`,
  function BspViewer(handle: Handle<BspViewerProps>) {
    let viewer: WorldviewViewer | null = null;
    let status = "Initializing WebGPU…";
    let error: string | null = null;
    let ready = false;

    return () => {
      const height = handle.props.height ?? 480;
      return (
        <div mix={rootStyle}>
          <canvas
            aria-label="Interactive BSP map"
            mix={[
              canvasStyle,
              ref((element, signal) => {
                const canvas = element as HTMLCanvasElement;
                void createWorldview({
                  canvas,
                  controls: "walk",
                  audio: false,
                  signal,
                })
                  .then(async (created) => {
                    viewer = created;
                    created.addEventListener("progress", (event) => {
                      const detail = (event as CustomEvent<ProgressDetail>).detail;
                      status = `${detail.phase}: ${detail.label ?? "loading"}`;
                      handle.update();
                    });
                    created.addEventListener("ready", () => {
                      ready = true;
                      handle.update();
                    });
                    created.addEventListener("warning", (event) => {
                      console.warn("Worldview:", event.detail.message);
                    });
                    await created.load({
                      bsp: handle.props.bspUrl,
                      ...(handle.props.paletteUrl ? { palette: handle.props.paletteUrl } : {}),
                      resolveWad: (reference) =>
                        routes.api.bspWad.href({
                          fileId: handle.props.fileId,
                          wadName: reference.basename,
                        }),
                    });
                  })
                  .catch((cause: unknown) => {
                    if (signal.aborted) return;
                    error = cause instanceof Error ? cause.message : String(cause);
                    handle.update();
                  });
                signal.addEventListener("abort", () => {
                  viewer?.dispose();
                  viewer = null;
                });
              }),
            ]}
            style={{ height: `${height}px` }}
          />
          {!ready ? (
            <div mix={overlayStyle}>
              <div mix={error ? [messageStyle, dangerTextStyle] : messageStyle}>
                {error ?? status}
              </div>
            </div>
          ) : null}
          {ready ? (
            <div mix={helpStyle}>Click to capture · WASD to move · V toggles noclip</div>
          ) : null}
        </div>
      );
    };
  },
);
