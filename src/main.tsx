import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConsoleApp as App } from "./v2/ConsoleApp";
import "./styles.css";
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
function registerServiceWorker() {
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js");
    });
  }
}
async function bootstrap() {
  if (import.meta.env.VITE_ENABLE_MOCKS === "true") {
    const { worker } = await import("./mocks/browser");
    const { setScenario } = await import("./mocks/handlers");
    await worker.start({
      onUnhandledRequest(request, print) {
        if (new URL(request.url).pathname.startsWith("/api/")) print.error();
      },
      quiet: true,
    });
    window.addEventListener("jarvis-mock-scenario", async (e) => {
      setScenario((e as CustomEvent<string>).detail);
      await queryClient.cancelQueries();
      await queryClient.resetQueries();
    });
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  );
  registerServiceWorker();
}
bootstrap().catch(() => {
  document.getElementById("root")!.textContent =
    "화면을 시작하지 못했습니다. 실행 상태를 확인한 뒤 새로고침해 주세요.";
});

import "./v2/console.css";
