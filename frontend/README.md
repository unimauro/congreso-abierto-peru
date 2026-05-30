# Frontend — Next.js (Fase 4)

Dashboards y módulos del observatorio. Stack objetivo: Next.js + React + TypeScript
+ Tailwind + shadcn/ui. Modo claro/oscuro, responsive, búsqueda global y filtros
avanzados. Estética inspirada en GitHub / Stripe Dashboard / Linear / Notion / ObservableHQ.

Módulos planificados: Dashboard ejecutivo, Congresistas, Bancadas, Proyectos de Ley
(pipeline visual + timeline), Votaciones (heatmaps/matrices), Comisiones, Personal, Presupuesto.

Aún no inicializado. Cuando arranque la Fase 4:

```bash
npx create-next-app@latest . --ts --tailwind --app --eslint
npx shadcn@latest init
```

Consumirá la Open Data API del backend (ver docs/ARCHITECTURE.md).
