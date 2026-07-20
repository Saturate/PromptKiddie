import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/layout";
import Dashboard from "./pages/Dashboard";
import Engagements from "./pages/Engagements";
import EngagementDetail from "./pages/EngagementDetail";
import Playbooks from "./pages/Playbooks";
import PlaybookDetail from "./pages/PlaybookDetail";
import Knowledge from "./pages/Knowledge";
import Settings from "./pages/Settings";
import Stats from "./pages/Stats";
import Status from "./pages/Status";
import Tools from "./pages/Tools";
import NotFound from "./pages/NotFound";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="engagements" element={<Engagements />} />
        <Route path="engagements/:id" element={<EngagementDetail />} />
        <Route path="playbooks" element={<Playbooks />} />
        <Route path="playbooks/:key" element={<PlaybookDetail />} />
        <Route path="knowledge" element={<Knowledge />} />
        <Route path="settings" element={<Settings />} />
        <Route path="stats" element={<Stats />} />
        <Route path="status" element={<Status />} />
        <Route path="tools" element={<Tools />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
