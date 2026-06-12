import { KLineView } from "./components/KLineView";
import { FloatTickerView, MainWorkspace, MinuteWindowView } from "./views/MainWorkspace";

export function App() {
  const hash = decodeURIComponent(window.location.hash);
  if (hash.startsWith("#/kline/")) {
    const [, , code, name] = hash.split("/");
    return <KLineView code={code} name={name ?? code} />;
  }
  if (hash.startsWith("#/minute/")) {
    const [, , code, name] = hash.split("/");
    return <MinuteWindowView code={code} name={name ?? code} />;
  }
  if (hash === "#/float") return <FloatTickerView />;
  return <MainWorkspace />;
}