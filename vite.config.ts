import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("node_modules/echarts/")) {
            if (id.includes("/echarts/lib/chart/")) return "vendor-echarts-chart";
            if (id.includes("/echarts/lib/component/")) return "vendor-echarts-component";
            if (id.includes("/echarts/lib/data/")) return "vendor-echarts-data";
            if (id.includes("/echarts/lib/coord/")) return "vendor-echarts-coord";
            if (id.includes("/echarts/lib/visual/")) return "vendor-echarts-visual";
            if (id.includes("/echarts/lib/layout/")) return "vendor-echarts-layout";
            return "vendor-echarts-core";
          }
          if (id.includes("node_modules/zrender/")) return "vendor-zrender";
          if (id.includes("node_modules/antd/")) {
            const antdMatch = id.match(/node_modules\/antd\/(?:es|lib)\/([^/]+)/);
            return `vendor-antd-${(antdMatch?.[1] ?? "core").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          }
          if (id.includes("node_modules/@ant-design/")) {
            const antDesignMatch = id.match(/node_modules\/@ant-design\/([^/]+)/);
            return `vendor-ant-design-${(antDesignMatch?.[1] ?? "core").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          }
          if (id.includes("react") || id.includes("react-dom")) return "vendor-react";
          if (id.includes("lucide-react")) return "vendor-icons";
          const match = id.match(/node_modules\/(?:@([^/]+)\/)?([^/]+)/);
          if (!match) return "vendor";
          return `vendor-${[match[1], match[2]].filter(Boolean).join("-").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        }
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false
  }
});
