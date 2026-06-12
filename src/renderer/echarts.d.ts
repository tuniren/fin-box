declare module "echarts" {
  export type ECharts = {
    clear: () => void;
    dispose: () => void;
    getOption?: () => unknown;
    off: (eventName: string, handler: (...args: any[]) => void) => void;
    on: (eventName: string, handler: (...args: any[]) => void) => void;
    resize: () => void;
    setOption: (option: unknown, notMerge?: boolean) => void;
  };

  export function init(
    dom: HTMLElement,
    theme?: string | object,
    opts?: {
      renderer?: "canvas" | "svg";
    }
  ): ECharts;
}
