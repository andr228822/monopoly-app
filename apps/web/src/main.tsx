import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

// Без React.StrictMode: его двойной вызов эффектов в dev ломает анимацию на
// таймерах/rAF (и не отражает поведение прод-сборки, где StrictMode — no-op).
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
