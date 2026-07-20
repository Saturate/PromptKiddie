import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/layout";
import Dashboard from "./pages/Dashboard";
import Engagements from "./pages/Engagements";
import EngagementDetail from "./pages/EngagementDetail";
import Chat from "./pages/Chat";
import Playbook from "./pages/Playbook";
import Knowledge from "./pages/Knowledge";
import Settings from "./pages/Settings";
import Stats from "./pages/Stats";
import Tools from "./pages/Tools";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="engagements" element={<Engagements />} />
        <Route path="engagements/:id" element={<EngagementDetail />} />
        <Route path="chat" element={<Chat />} />
        <Route path="playbook" element={<Playbook />} />
        <Route path="knowledge" element={<Knowledge />} />
        <Route path="settings" element={<Settings />} />
        <Route path="stats" element={<Stats />} />
        <Route path="tools" element={<Tools />} />
      </Route>
    </Routes>
  );
}
