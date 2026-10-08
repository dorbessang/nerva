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
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
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
import TeamCalendar from "./pages/TeamCalendar";

export function ProtectedRoute({ children }) {
  const { user, loading, needsOnboarding, isPasswordRecovery } = useAuth();
  if (loading) return <div style={styles.loading}>Cargando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  // Chequeo antes que needsOnboarding e incondicional a cualquier otra
  // cosa: una sesión de recuperación no debe dejar pasar a ningún lado de
  // la app hasta que se elija una contraseña nueva (ver ResetPasswordRoute).
  if (isPasswordRecovery) return <Navigate to="/reset-password" replace />;
  if (needsOnboarding) return <Navigate to="/set-password" replace />;
  return <Layout>{children}</Layout>;
}

// Landing pública ("/"): si ya hay sesión activa no tiene sentido mostrarle
// la landing de venta a quien ya es usuario — se lo manda directo al
// dashboard, mismo criterio que SetPasswordRoute usa más abajo.
export function LandingRoute() {
  const { user, loading, needsOnboarding, isPasswordRecovery } = useAuth();
  if (loading) return <div style={styles.loading}>Cargando...</div>;
  if (user && isPasswordRecovery) return <Navigate to="/reset-password" replace />;
  if (user && !needsOnboarding) return <Navigate to="/dashboard" replace />;
  if (user && needsOnboarding) return <Navigate to="/set-password" replace />;
  return <Landing />;
}

// Evita el caso inverso: alguien que ya completó el alta (full_name
// seteado) pero reabre un link de invitación viejo, o entra a /set-password
// a mano — lo manda derecho al dashboard en vez de mostrarle el formulario
// de nuevo.
export function SetPasswordRoute() {
  const { user, loading, needsOnboarding } = useAuth();
  if (loading) return <div style={styles.loading}>Cargando...</div>;
  if (user && !needsOnboarding) return <Navigate to="/dashboard" replace />;
  return <SetPassword />;
}

// Al llegar desde el link de "olvidé mi contraseña" (propio o mandado a
// mano desde el dashboard de Supabase), isPasswordRecovery es lo único que
// importa -- a diferencia de SetPasswordRoute, acá no se mira needsOnboarding
// (quien resetea ya tiene el alta completa). Sin sesión de recuperación no
// hay nada que hacer acá: si hay una sesión normal se manda al dashboard,
// si no hay ninguna sesión se manda a /login.
export function ResetPasswordRoute() {
  const { user, loading, isPasswordRecovery } = useAuth();
  if (loading) return <div style={styles.loading}>Cargando...</div>;
  if (!isPasswordRecovery) return <Navigate to={user ? "/dashboard" : "/login"} replace />;
  return <ResetPassword />;
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
          <Route path="/" element={<LandingRoute />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPasswordRoute />} />
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
            path="/calendario"
            element={
              <ProtectedRoute>
                <TeamCalendar />
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
