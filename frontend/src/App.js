import "@/App.css";
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import NovaStream from "@/pages/NovaStream";
import EmbedPage from "@/pages/EmbedPage";
import DaddyEmbedPage from "@/pages/DaddyEmbedPage";
import SportsEmbedPage from "@/pages/SportsEmbedPage";
import SportsTokenRedirect from "@/pages/SportsTokenRedirect";
import FootballEmbedPage from "@/pages/FootballEmbedPage";
import FootballTokenRedirect from "@/pages/FootballTokenRedirect";
import ApiDocs from "@/pages/ApiDocs";
import MultiView from "@/pages/MultiView";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Admin from "@/pages/Admin";
import { AuthProvider } from "@/context/AuthContext";
import { FavoritesProvider } from "@/hooks/useFavorites";
import { Toaster } from "sonner";

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <FavoritesProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<NovaStream />} />
              <Route path="/embed/:channelId" element={<EmbedPage />} />
              <Route path="/embed/daddy/:channelId" element={<DaddyEmbedPage />} />
              <Route path="/embed/sports/t/:token" element={<SportsTokenRedirect />} />
              <Route path="/embed/sports/:source/:id" element={<SportsEmbedPage />} />
              <Route path="/embed/football/t/:token" element={<FootballTokenRedirect />} />
              <Route path="/embed/football/:matchId/:serverIdx?" element={<FootballEmbedPage />} />
              <Route path="/docs" element={<ApiDocs />} />
              <Route path="/multiview" element={<MultiView />} />
              <Route path="/login" element={<Login />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/admin" element={<Admin />} />
              {/* DaddyTV & Sports are now tabs inside NovaStream; legacy URLs redirect home */}
              <Route path="/daddy" element={<Navigate to="/" replace />} />
              <Route path="/sports" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
          <Toaster theme="dark" position="bottom-right" />
        </FavoritesProvider>
      </AuthProvider>
    </div>
  );
}

export default App;
