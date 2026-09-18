// Landing.jsx — Landing pública de la vertical CRM (gonerva.com). Sin
// self-registration ni planes todavía (Etapa 2) — el CTA solo deja un mail
// en landing_leads para contactar a mano.

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Menu, X, ArrowRight, Check, BarChart3, Mail } from "lucide-react";
import { supabase } from "../lib/supabase";
import "./Landing.css";

const HERO_STATS = { projects: 18, closeRate: 62, pipeline: 284500 };

const STATE_BARS = [
  { key: "contacto", name: "Contacto inicial", count: 7, pct: 70, color: "#60a5fa" },
  { key: "negociacion", name: "Negociación", count: 5, pct: 45, color: "#f59e0b" },
  { key: "ganado", name: "Ganado", count: 6, pct: 30, color: "#34D399" },
];

const TABS = [
  { title: "Pipeline de negociaciones", desc: "Kanban con tus propios estados — probá mover una tarjeta." },
  { title: "Entidades con historial", desc: "Proveedores, clientes y distribuidores en un mismo lugar." },
  { title: "Productos y precios", desc: "Historial de cotizaciones por fecha y presentación." },
  { title: "Tareas con aprobación", desc: "Probá aprobar o rechazar una tarea pendiente." },
];

const ENTITIES_DEMO = [
  { name: "EuroPharma Distribución", type: "Proveedor", badgeBg: "#dbeafe", badgeColor: "#1d4ed8", flag: "🇪🇸", active: true },
  { name: "Distribuidora Andina", type: "Distribuidor", badgeBg: "#ede9fe", badgeColor: "#6d28d9", flag: "🇨🇴", active: false },
  { name: "Retail Norte S.A.", type: "Cliente", badgeBg: "#fef3c7", badgeColor: "#92400e", flag: "🇦🇷", active: true },
  { name: "Conderco Insumos", type: "Proveedor", badgeBg: "#dbeafe", badgeColor: "#1d4ed8", flag: "🇧🇷", active: false },
];

const PRICE_HISTORY = [
  { date: "12/03/2026", presentation: "Caja x 30 comp.", price: "USD 18,40" },
  { date: "02/06/2026", presentation: "Caja x 30 comp.", price: "USD 19,10" },
  { date: "30/08/2026", presentation: "Caja x 60 comp.", price: "USD 34,90" },
];

const STEPS = [
  { title: "Cargá tus entidades", desc: "Proveedores, clientes y distribuidores, a mano o importando tu planilla actual." },
  { title: "Armá tu pipeline", desc: "Definí los estados que ya usás y empezá a cargar negociaciones en curso." },
  { title: "Sumá a tu equipo", desc: "Invitá por mail con el rol justo — owner, admin, editor o solo lectura." },
  { title: "Mirá el dashboard", desc: "El estado real de la operación, sin pedirle un resumen a nadie." },
];

const FAQS = [
  {
    q: "¿Cómo se crea mi cuenta hoy?",
    a: "Por ahora el acceso es por invitación: nos escribís, coordinamos una demo y armamos tu workspace con vos. Todavía no hay un registro 100% autoservicio — está en el plan, pero no es el paso en el que estamos ahora.",
  },
  {
    q: "¿Puedo sumar a mi equipo?",
    a: "Sí. Invitás por mail con el rol que corresponda (Owner, Admin, Editor o Viewer) y cada quien entra con su propia cuenta corporativa.",
  },
  {
    q: "¿Reemplaza mi CRM o mi Excel actual?",
    a: "Está pensado para reemplazar la mezcla de planilla + mail + memoria propia, no para agregarse como una herramienta más arriba de eso.",
  },
  {
    q: "¿Cuánto cuesta?",
    a: "Todavía no tenemos planes publicados — lo conversamos directo cuando coordinamos la demo, según el tamaño de tu equipo.",
  },
];

const INITIAL_KANBAN = {
  col0: [
    { id: "a", label: "Distribuidora Andina — Línea X" },
    { id: "b", label: "Retail Norte S.A." },
  ],
  col1: [{ id: "c", label: "EuroPharma Distribución" }],
  col2: [{ id: "d", label: "Conderco Insumos" }],
};

const KANBAN_COLUMNS = [
  { key: "col0", name: "Contacto inicial" },
  { key: "col1", name: "Negociación" },
  { key: "col2", name: "Ganado" },
];

function cloneInitialKanban() {
  return {
    col0: [...INITIAL_KANBAN.col0],
    col1: [...INITIAL_KANBAN.col1],
    col2: [...INITIAL_KANBAN.col2],
  };
}

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="nv-wrap">
      <Nav scrolled={scrolled} mobileOpen={mobileOpen} onToggleMobile={() => setMobileOpen((o) => !o)} />
      <Hero />
      <PensadoPara />
      <ProductShowcase activeTab={activeTab} onSelectTab={setActiveTab} />
      <HowItWorks />
      <Faq />
      <CtaSection />
      <Footer />
    </div>
  );
}

function Nav({ scrolled, mobileOpen, onToggleMobile }) {
  return (
    <div className={`nv-nav ${scrolled ? "scrolled" : ""}`}>
      <div className="nv-nav-inner">
        <div className="nv-logo">
          <img src="/favicon.png" width="28" height="28" alt="" />
          <span>NERVA</span>
        </div>
        <div className="nv-nav-links">
          <a className="nv-link" href="#producto">Producto</a>
          <a className="nv-link" href="#como-funciona">Cómo funciona</a>
          <a className="nv-link" href="#preguntas">Preguntas frecuentes</a>
        </div>
        <div className="nv-nav-right">
          <Link className="nv-link nv-login-link" to="/login">Ingresar</Link>
          <a href="#pedir-acceso"><button className="nv-btn-primary">Pedí acceso</button></a>
          <button
            className="nv-mobile-toggle"
            onClick={onToggleMobile}
            aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="nv-mobile-menu">
          <a className="nv-link" href="#producto" onClick={onToggleMobile}>Producto</a>
          <a className="nv-link" href="#como-funciona" onClick={onToggleMobile}>Cómo funciona</a>
          <a className="nv-link" href="#preguntas" onClick={onToggleMobile}>Preguntas frecuentes</a>
          <Link className="nv-link" to="/login" onClick={onToggleMobile}>Ingresar</Link>
        </div>
      )}
    </div>
  );
}

function Hero() {
  const [counts, setCounts] = useState({ projects: 0, closeRate: 0, pipeline: 0 });
  const [barsGrown, setBarsGrown] = useState(false);

  useEffect(() => {
    const duration = 1200;
    let start = null;
    let rafId = requestAnimationFrame(step);

    function step(ts) {
      if (start === null) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCounts({
        projects: Math.round(HERO_STATS.projects * eased),
        closeRate: Math.round(HERO_STATS.closeRate * eased),
        pipeline: Math.round(HERO_STATS.pipeline * eased),
      });
      if (progress < 1) rafId = requestAnimationFrame(step);
    }

    const barTimer = setTimeout(() => setBarsGrown(true), 120);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(barTimer);
    };
  }, []);

  return (
    <div className="nv-hero">
      <div className="nv-hero-grid">
        <div className="nv-hero-copy">
          <div className="nv-badge">
            <span className="nv-pulse-dot" />
            CRM para negociaciones de licensing y distribución
          </div>
          <h1>El cerebro externo de tu operación comercial</h1>
          <p className="nv-lead">
            Pipeline, entidades, productos con historial de precio y tareas con aprobación, todo en un
            solo lugar — para dejar de perseguir el estado de cada negociación en el mail, WhatsApp y
            una planilla distinta por proveedor.
          </p>
          <div className="nv-hero-ctas">
            <a href="#pedir-acceso"><button className="nv-btn-primary-lg">Pedí acceso</button></a>
            <a href="#producto"><button className="nv-btn-ghost-lg">Ver cómo funciona</button></a>
          </div>
        </div>

        <div className="nv-hero-visual nv-float">
          <div className="nv-hero-card">
            <div className="nv-stat-grid">
              <div className="nv-stat-box">
                <div className="nv-stat-label">Proyectos en curso</div>
                <div className="nv-stat-value">{counts.projects}</div>
                <div className="nv-stat-detail">6 completados</div>
              </div>
              <div className="nv-stat-box">
                <div className="nv-stat-label">Tasa de cierre</div>
                <div className="nv-stat-value">{counts.closeRate}%</div>
                <div className="nv-stat-detail">llegó a estado final</div>
              </div>
            </div>

            <div className="nv-state-box">
              <div className="nv-state-box-title">Proyectos por estado</div>
              {STATE_BARS.map((bar, i) => (
                <div className="nv-state-row" key={bar.key}>
                  <span className="nv-state-name">{bar.name}</span>
                  <div className="nv-state-bar-bg">
                    <div
                      className="nv-state-bar-fill"
                      style={{
                        width: barsGrown ? `${bar.pct}%` : "0%",
                        background: bar.color,
                        transitionDelay: `${i * 0.1}s`,
                      }}
                    />
                  </div>
                  <span className="nv-state-count">{bar.count}</span>
                </div>
              ))}
            </div>

            <div className="nv-pipeline-row">
              <span className="nv-pipeline-label">Valor de pipeline</span>
              <span className="nv-pipeline-value">USD {counts.pipeline.toLocaleString("es-AR")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PensadoPara() {
  return (
    <div className="nv-strip">
      <div className="nv-strip-inner">
        <p className="nv-strip-eyebrow">Pensado para un tipo de negocio concreto</p>
        <p className="nv-strip-headline">
          Equipos que arman deals de licensing y distribución con proveedores, clientes y
          distribuidores en varios países — donde cada negociación tiene su propio cronograma de
          pagos, su comisión y su propia historia de precios.
        </p>
      </div>
    </div>
  );
}

function ProductShowcase({ activeTab, onSelectTab }) {
  return (
    <div className="nv-section" id="producto">
      <div className="nv-container">
        <div className="nv-section-head">
          <p className="nv-eyebrow">Producto</p>
          <h2 className="nv-h2">Todo lo que hoy se te reparte entre Excel, mail y WhatsApp</h2>
          <p className="nv-section-sub">Elegí una sección para ver cómo se ve adentro — el panel de la derecha es interactivo.</p>
        </div>

        <div className="nv-showcase-grid">
          <div className="nv-tabs">
            {TABS.map((tab, i) => (
              <button
                key={tab.title}
                className={`nv-tab-btn ${activeTab === i ? "active" : ""}`}
                onClick={() => onSelectTab(i)}
              >
                <span className="nv-tab-title">{tab.title}</span>
                <span className="nv-tab-desc">{tab.desc}</span>
              </button>
            ))}
          </div>

          <div className="nv-showcase-panel">
            {activeTab === 0 && <KanbanDemo />}
            {activeTab === 1 && <EntitiesDemo />}
            {activeTab === 2 && <PricingDemo />}
            {activeTab === 3 && <TasksDemo />}
          </div>
        </div>

        <div className="nv-features-grid">
          <div className="nv-feature-card">
            <BarChart3 size={24} color="#0B1F3A" />
            <div className="nv-feature-title">Dashboard en tiempo real</div>
            <div className="nv-feature-desc">
              Valor de pipeline por moneda, tiempo promedio en cada etapa y tasa de cierre por tipo de
              entidad — sin armar el reporte a mano.
            </div>
          </div>
          <div className="nv-feature-card">
            <Mail size={24} color="#0B1F3A" />
            <div className="nv-feature-title">Bitácora automática por mail</div>
            <div className="nv-feature-desc">
              Con copia a una dirección de Nerva, cada mail con un contacto cargado queda registrado
              solo en la entidad correspondiente.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KanbanDemo() {
  const [kanban, setKanban] = useState(cloneInitialKanban);

  function advance(fromKey, toKey, cardId) {
    setKanban((prev) => {
      const card = prev[fromKey].find((c) => c.id === cardId);
      if (!card) return prev;
      return {
        ...prev,
        [fromKey]: prev[fromKey].filter((c) => c.id !== cardId),
        [toKey]: [...prev[toKey], card],
      };
    });
  }

  return (
    <div>
      <div className="nv-kanban-head">
        <span className="nv-kanban-title">Negociaciones — vista Kanban</span>
        <button className="nv-reset-link" onClick={() => setKanban(cloneInitialKanban())}>
          reiniciar demo
        </button>
      </div>
      <div className="nv-kanban-grid">
        {KANBAN_COLUMNS.map((col, idx) => (
          <div key={col.key} className={`nv-kanban-col ${col.key === "col2" ? "won" : ""}`}>
            <div className="nv-kanban-col-head">
              <span>{col.name}</span>
              <span>{kanban[col.key].length}</span>
            </div>
            {kanban[col.key].map((card) => (
              <div className="nv-kanban-card" key={card.id}>
                <span>{card.label}</span>
                {idx < 2 && (
                  <button
                    className="nv-kanban-advance"
                    aria-label="Avanzar"
                    onClick={() => advance(col.key, idx === 0 ? "col1" : "col2", card.id)}
                  >
                    <ArrowRight size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function EntitiesDemo() {
  return (
    <div>
      <span className="nv-showcase-title">Entidades</span>
      {ENTITIES_DEMO.map((e) => (
        <div className="nv-entity-row" key={e.name}>
          <span className={`nv-dot ${e.active ? "on" : ""}`} />
          <span className="nv-entity-name">{e.name}</span>
          <span className="nv-entity-badge" style={{ background: e.badgeBg, color: e.badgeColor }}>
            {e.type}
          </span>
          <span className="nv-entity-flag">{e.flag}</span>
        </div>
      ))}
      <p className="nv-showcase-note">Cada fila trae su bitácora de actividad, contactos y proyectos vinculados.</p>
    </div>
  );
}

function PricingDemo() {
  return (
    <div>
      <span className="nv-showcase-title nv-showcase-title--tight">Historial de precios — Línea Respiratoria 20mg</span>
      <p className="nv-showcase-note nv-showcase-note--top">Cotizado a Retail Norte S.A.</p>
      <div className="nv-price-grid nv-price-grid--head">
        <span>Fecha</span>
        <span>Presentación</span>
        <span className="nv-price-right">Precio</span>
      </div>
      {PRICE_HISTORY.map((row) => (
        <div className="nv-price-grid" key={row.date}>
          <span>{row.date}</span>
          <span>{row.presentation}</span>
          <span className="nv-price-right nv-price-amount">{row.price}</span>
        </div>
      ))}
    </div>
  );
}

function TasksDemo() {
  const [approval, setApproval] = useState("pending"); // pending | approved | rejected

  return (
    <div>
      <span className="nv-showcase-title">Tareas de hoy</span>
      <div className="nv-task-row">
        <input type="checkbox" checked disabled aria-label="Tarea completada" />
        <span className="nv-task-done">Enviar propuesta a Retail Norte</span>
      </div>

      <div className="nv-task-approval-row">
        <div className="nv-task-approval-head">
          <input type="checkbox" disabled aria-label="Tarea pendiente" />
          <div>
            <div className="nv-task-approval-title">Aprobar comisión 8% — Distribuidora Andina</div>
            <div className="nv-task-approval-meta">Requiere aprobación · asignado a Gerva</div>
          </div>
        </div>
        {approval === "pending" && (
          <div className="nv-task-approval-actions">
            <button className="nv-approve-btn" onClick={() => setApproval("approved")}>Aprobar</button>
            <button className="nv-reject-btn" onClick={() => setApproval("rejected")}>Rechazar</button>
          </div>
        )}
        {approval === "approved" && (
          <div className="nv-task-approved"><Check size={14} /> Aprobada</div>
        )}
        {approval === "rejected" && <div className="nv-task-rejected">Rechazada</div>}
      </div>

      <div className="nv-task-row nv-task-row--last">
        <input type="checkbox" disabled aria-label="Tarea pendiente" />
        <span className="nv-task-title">Registrar llamada con EuroPharma</span>
        <span className="nv-task-due">vence hoy</span>
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="nv-section nv-section--alt" id="como-funciona">
      <div className="nv-container">
        <div className="nv-section-head nv-section-head--tight">
          <p className="nv-eyebrow">Cómo funciona</p>
          <h2 className="nv-h2 nv-h2--flush">De cero a tu primer pipeline armado, en una tarde</h2>
        </div>
        <div className="nv-steps-grid">
          {STEPS.map((step, i) => (
            <div key={step.title}>
              <div className="nv-step-num">{i + 1}</div>
              <div className="nv-step-title">{step.title}</div>
              <div className="nv-step-desc">{step.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Faq() {
  const [openSet, setOpenSet] = useState(() => new Set([0]));

  function toggle(i) {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className="nv-section" id="preguntas">
      <div className="nv-faq-wrap">
        <p className="nv-eyebrow nv-eyebrow--center">Preguntas frecuentes</p>
        <h2 className="nv-h2 nv-h2--center">Antes de pedir acceso</h2>
        {FAQS.map((faq, i) => {
          const open = openSet.has(i);
          return (
            <div className="nv-faq-item" key={faq.q}>
              <button className="nv-faq-btn" onClick={() => toggle(i)} aria-expanded={open}>
                <span>{faq.q}</span>
                <span className="nv-faq-mark">{open ? "–" : "+"}</span>
              </button>
              {open && <p className="nv-faq-answer">{faq.a}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CtaSection() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | submitting | success | error

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email) return;
    setStatus("submitting");
    const { error } = await supabase.from("landing_leads").insert({ email });
    if (error) {
      setStatus("error");
      return;
    }
    setStatus("success");
  }

  return (
    <div className="nv-cta" id="pedir-acceso">
      <div className="nv-cta-inner">
        <h2>¿Sacamos tu operación comercial del Excel?</h2>
        <p>Dejanos tu mail y coordinamos una demo de 20 minutos con tu propio caso.</p>

        {status === "success" ? (
          <div className="nv-cta-success">¡Listo! Te vamos a escribir a {email} a la brevedad.</div>
        ) : (
          <form className="nv-cta-row" onSubmit={handleSubmit}>
            <label htmlFor="nv-email" className="nv-visually-hidden">Tu email de trabajo</label>
            <input
              id="nv-email"
              className="nv-input"
              type="email"
              required
              placeholder="tu@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="nv-btn-dark" type="submit" disabled={status === "submitting"}>
              {status === "submitting" ? "Enviando..." : "Pedí acceso"}
            </button>
          </form>
        )}

        {status === "error" && (
          <p className="nv-cta-error">No pudimos guardar tu mail. Probá de nuevo en un momento.</p>
        )}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div className="nv-footer">
      <div className="nv-footer-inner">
        <div className="nv-footer-brand">
          <img src="/favicon.png" width="20" height="20" alt="" />
          <span>NERVA</span>
        </div>
        <span className="nv-footer-tag">gonerva.com — parte del universo Nerva</span>
      </div>
    </div>
  );
}
