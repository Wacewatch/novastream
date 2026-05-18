import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import NovaStream from "@/pages/NovaStream";
import EmbedPage from "@/pages/EmbedPage";
import ApiDocs from "@/pages/ApiDocs";
import MultiView from "@/pages/MultiView";
import { Toaster } from "sonner";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<NovaStream />} />
          <Route path="/embed/:channelId" element={<EmbedPage />} />
          <Route path="/docs" element={<ApiDocs />} />
          <Route path="/multiview" element={<MultiView />} />
        </Routes>
      </BrowserRouter>
      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
}

export default App;
