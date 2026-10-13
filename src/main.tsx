import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
const App =
  new URLSearchParams(window.location.search).get("workspace") === "events"
    ? lazy(() => import("./App"))
    : lazy(() => import("./daily/DailyApp"));
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense
      fallback={
        <div style={{ padding: 40, fontFamily: "system-ui" }}>
          Opening Ripple…
        </div>
      }
    >
      <App />
    </Suspense>
  </StrictMode>,
);
