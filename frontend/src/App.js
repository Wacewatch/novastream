import "@/App.css";
import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import NovaStream from "@/pages/NovaStream";
import EmbedPage from "@/pages/EmbedPage";
import ApiDocs from "@/pages/ApiDocs";
import MultiView from "@/pages/MultiView";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Admin from "@/pages/Admin";
import { AuthProvider } from "@/context/AuthContext";
import { Toaster } from "sonner";

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<NovaStream />} />
            <Route path="/embed/:channelId" element={<EmbedPage />} />
            <Route path="/docs" element={<ApiDocs />} />
            <Route path="/multiview" element={<MultiView />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
        </BrowserRouter>
        <Toaster theme="dark" position="bottom-right" />
      </AuthProvider>
    </div>
  );
}

export default App;
