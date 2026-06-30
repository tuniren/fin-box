import { KLineView } from "./components/KLineView";
import { FloatTickerView, MainWorkspace, MottoWindowView, WatchFloatView } from "./views/MainWorkspace";

export function App() {
  const hash = decodeURIComponent(window.location.hash);
  if (hash.startsWith("#/kline/")) {
    const [, , code, name] = hash.split("/");
    return <KLineView code={code} name={name ?? code} />;
  }
  if (hash === "#/float") return <FloatTickerView />;
  if (hash === "#/watch-float") return <WatchFloatView />;
  if (hash === "#/motto") return <MottoWindowView />;
  return <MainWorkspace />;
}
