import { KLineView } from "./components/KLineView";
import { CamouflageFloatView, MottoFloatView, WatchlistFloatView } from "./components/FloatingWindows";
import { MainWorkspace } from "./views/MainWorkspace";

export function App() {
  const hash = decodeURIComponent(window.location.hash);
  if (hash.startsWith("#/kline/")) {
    const [, , code, name] = hash.split("/");
    return <KLineView code={code} name={name ?? code} />;
  }
  if (hash === "#/float") return <CamouflageFloatView />;
  if (hash === "#/watch-float") return <WatchlistFloatView />;
  if (hash === "#/motto") return <MottoFloatView />;
  return <MainWorkspace />;
}
