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
import Products from "./pages/Products";
import Negotiations from "./pages/Negotiations";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import Agenda from "./pages/Agenda";

function ProtectedRoute({ children }) {
  const { user, loading, needsOnboarding } = useAuth();
  if (loading) return <div style={styles.loading}>Cargando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (needsOnboarding) return <Navigate to="/set-password" replace />;
  return <Layout>{children}</Layout>;
}

// Evita el caso inverso: alguien que ya completó el alta (full_name
// seteado) pero reabre un link de invitación viejo, o entra a /set-password
// a mano — lo manda derecho al dashboard en vez de mostrarle el formulario
// de nuevo.
function SetPasswordRoute() {
  const { user, loading, needsOnboarding } = useAuth();
  if (loading) return <div style={styles.loading}>Cargando...</div>;
  if (user && !needsOnboarding) return <Navigate to="/dashboard" replace />;
  return <SetPassword />;
}

function EntityRoute() {
  const { id } = useParams();
  const [entityType, setEntityType] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("entity_types")
      .select("id, name, plural")
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
  const pluralName = entityType.plural ||
    (entityType.name.endsWith("r") ? entityType.name + "es" : entityType.name + "s");

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
          <Route path="/set-password" element={<SetPasswordRoute />} />
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
            path="/agenda"
            element={
              <ProtectedRoute>
                <Agenda />
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
            path="/entities"
            element={
              <ProtectedRoute>
                <Entities />
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
            path="/products"
            element={
              <ProtectedRoute>
                <Products />
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
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
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
};

export default App;
