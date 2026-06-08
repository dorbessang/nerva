import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import Login from "./pages/Login";
import SetPassword from "./pages/SetPassword";
import Layout from "./components/Layout";
import Tasks from "./pages/Tasks";
import Entities from "./pages/Entities";
import Negotiations from "./pages/Negotiations";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={styles.loading}>Cargando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function EntityRoute() {
  const { id } = useParams();
  const [entityType, setEntityType] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("entity_types")
      .select("id, name")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        setEntityType(data);
        setLoading(false);
      });
  }, [id]);

  if (loading) return <div style={styles.loading}>Cargando...</div>;
  if (!entityType) return <Navigate to="/dashboard" replace />;

  const singularName = entityType.name;
  const pluralName = entityType.name.endsWith("r")
    ? entityType.name + "es"
    : entityType.name + "s";

  return (
    <Entities
      entityTypeId={entityType.id}
      entityTypeName={pluralName}
      entityTypeSingular={singularName}
    />
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tasks"
            element={
              <ProtectedRoute>
                <Tasks />
              </ProtectedRoute>
            }
          />
          <Route
            path="/negotiations"
            element={
              <ProtectedRoute>
                <Negotiations />
              </ProtectedRoute>
            }
          />
          <Route
            path="/entities/:id"
            element={
              <ProtectedRoute>
                <EntityRoute />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

const styles = {
  loading: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#6b7280",
    fontSize: "14px",
  },
  placeholder: {
    padding: "48px",
    fontSize: "18px",
    color: "#0B1F3A",
  },
};

export default App;
