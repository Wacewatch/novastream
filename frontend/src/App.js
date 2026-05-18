import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import NovaStream from "@/pages/NovaStream";
import { Toaster } from "sonner";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<NovaStream />} />
        </Routes>
      </BrowserRouter>
      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
}

export default App;
